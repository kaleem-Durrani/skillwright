import { Request, Response, NextFunction } from "express";
import { ResourceType } from "@prisma/client";
import prisma from "../db/prisma.js";
import { uploadFile, deleteFile } from "../utils/cloudinary.js";
import { cleanupUpload } from "../middleware/uploadMiddleware.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";
import { validationResult } from "express-validator";

// @desc    Create a new resource
// @route   POST /api/resource
// @access  Private (Teacher)
export const createResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new ValidationError({ file: ["No file uploaded"] });
    }

    const { title, description, courseId, isPublic = false } = req.body;

    // Upload to Cloudinary
    const cloudinaryResult = await uploadFile(req.file);

    // Create resource in database
    const resource = await prisma.resource.create({
      data: {
        title,
        description,
        type: determineResourceType(req.file.mimetype),
        url: cloudinaryResult.url,
        mimeType: cloudinaryResult.mimeType,
        courseId,
        teacherId: req.teacher!.id,
        isPublic: isPublic === 'true' || isPublic === true
      }
    });

    // Clean up temporary file
    cleanupUpload(req.file.path);

    res.status(201).json({
      success: true,
      data: resource
    });

  } catch (error) {
    // Clean up temporary file if it exists
    if (req.file) {
      cleanupUpload(req.file.path);
    }
    next(error);
  }
};

// @desc    Update a resource
// @route   PUT /api/resource/:id
// @access  Private (Teacher)
export const updateResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { title, description, isPublic } = req.body;

    const resource = await prisma.resource.findUnique({
      where: { id }
    });

    if (!resource) {
      throw new ValidationError({ resource: ["Resource not found"] });
    }

    if (resource.teacherId !== req.teacher!.id) {
      throw new ValidationError({ auth: ["You can only update your own resources"] });
    }

    let updateData: any = {
      title,
      description,
      isPublic: isPublic !== undefined ? (isPublic === 'true' || isPublic === true) : undefined
    };

    // If a new file is uploaded, replace the old one
    if (req.file) {
      // Delete old file from Cloudinary
      const oldPublicId = extractPublicId(resource.url);
      await deleteFile(oldPublicId);

      // Upload new file to Cloudinary
      const cloudinaryResult = await uploadFile(req.file);

      updateData.url = cloudinaryResult.url;
      updateData.type = determineResourceType(req.file.mimetype);
      updateData.mimeType = cloudinaryResult.mimeType;

      // Clean up temporary file
      cleanupUpload(req.file.path);
    }

    const updatedResource = await prisma.resource.update({
      where: { id },
      data: updateData,
      include: {
        course: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            comments: true,
          },
        },
      },
    });

    res.json({
      success: true,
      message: "Resource updated successfully",
      data: updatedResource
    });

  } catch (error) {
    // Clean up temporary file if it exists
    if (req.file) {
      cleanupUpload(req.file.path);
    }
    next(error);
  }
};

// @desc    Delete a resource
// @route   DELETE /api/resource/:id
// @access  Private (Teacher)
export const deleteResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id }
    });

    if (!resource) {
      throw new ValidationError({ resource: ["Resource not found"] });
    }

    if (resource.teacherId !== req.teacher!.id) {
      throw new ValidationError({ auth: ["You can only delete your own resources"] });
    }

    // Delete from Cloudinary
    const publicId = extractPublicId(resource.url);
    await deleteFile(publicId);

    // Delete from database
    await prisma.resource.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: "Resource deleted successfully"
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get a resource
// @route   GET /api/resource/:id
// @access  Private (Course Access)
export const getResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        teacher: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!resource) {
      throw new ValidationError({ resource: ["Resource not found"] });
    }

    res.json({
      success: true,
      data: resource
    });

  } catch (error) {
    next(error);
  }
};

// @desc    Get resource comments with pagination
// @route   GET /api/resource/:id/comments
// @access  Private (Course Access)
export const getResourceComments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Extract query parameters for pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await prisma.resourceComment.count({
      where: {
        resourceId: id,
        parentId: null, // Only count top-level comments
      }
    });

    const comments = await prisma.resourceComment.findMany({
      where: {
        resourceId: id,
        parentId: null, // Only get top-level comments
      },
      include: {
        teacher: {
          select: {
            id: true,
            name: true
          }
        },
        student: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit,
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    res.json({
      success: true,
      message: "Comments retrieved successfully",
      data: {
        items: comments,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasMore,
        },
      }
    });

  } catch (error) {
    next(error);
  }
};

// Helper function to determine resource type from mimetype
const determineResourceType = (mimetype: string): ResourceType => {
  if (mimetype.startsWith('image/')) return ResourceType.DOCUMENT;
  if (mimetype.startsWith('video/')) return ResourceType.VIDEO;
  if (mimetype.startsWith('application/')) return ResourceType.DOCUMENT;
  return ResourceType.DOCUMENT; // Default case
};

// Helper function to extract public ID from Cloudinary URL
const extractPublicId = (url: string): string => {
  const parts = url.split('/');
  const filename = parts[parts.length - 1];
  return filename.split('.')[0];
};

// @desc    Get all public resources with pagination
// @route   GET /api/resource/public
// @access  Public
export const getAllPublicResources = asyncHandler(async (req: Request, res: Response) => {
  // Extract query parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string;
  const type = req.query.type as string;

  // Calculate skip value for pagination
  const skip = (page - 1) * limit;

  // Build where clause
  const where: any = { isPublic: true };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (type) {
    where.type = type;
  }

  // Get total count for pagination
  const total = await prisma.resource.count({ where });

  // Get resources with pagination
  const resources = await prisma.resource.findMany({
    where,
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      course: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      teacher: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          comments: true,
        },
      },
    },
  });

  // Calculate pagination info
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;

  res.status(200).json({
    success: true,
    message: "Public resources retrieved successfully",
    data: {
      items: resources,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
    },
  });
});

// @desc    Get resource by ID
// @route   GET /api/resources/:id
// @access  Public
export const getResourceById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const resource = await prisma.resource.findUnique({
    where: { id },
    include: {
      course: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      teacher: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          comments: true,
        },
      },
    },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  if (!resource.isPublic && (!req.teacher || resource.teacherId !== req.teacher.id)) {
    throw new ForbiddenError("You do not have access to this resource");
  }

  res.status(200).json({
    success: true,
    message: "Resource retrieved successfully",
    data: resource,
  });
});

// @desc    Create resource comment
// @route   POST /api/resources/:id/comments
// @access  Private (Student/Teacher)
export const createResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id } = req.params;
  const { content, parentId } = req.body;

  // Using transaction to ensure data consistency
  const comment = await prisma.$transaction(async (tx) => {
    const resource = await tx.resource.findUnique({
      where: { id },
    });

    if (!resource) {
      throw new NotFoundError("Resource not found");
    }

    if (!resource.isPublic && (!req.teacher || resource.teacherId !== req.teacher.id)) {
      throw new ForbiddenError("You do not have access to this resource");
    }

    if (parentId) {
      const parentComment = await tx.resourceComment.findUnique({
        where: { id: parentId },
      });

      if (!parentComment) {
        throw new NotFoundError("Parent comment not found");
      }

      if (parentComment.resourceId !== id) {
        throw new ValidationError({
          comment: ["Parent comment does not belong to this resource"],
        });
      }
    }

    return await tx.resourceComment.create({
      data: {
        content,
        resourceId: id,
        teacherId: req.teacher?.id,
        studentId: req.student?.id,
        parentId,
      },
      include: {
        teacher: {
          select: {
            id: true,
            name: true,
          },
        },
        student: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  });

  res.status(201).json({
    success: true,
    message: "Comment created successfully",
    data: comment,
  });
});

// @desc    Update resource comment
// @route   PUT /api/resources/comments/:commentId
// @access  Private (Student/Teacher)
export const updateResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { commentId } = req.params;
  const { content } = req.body;

  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  if (
    (req.teacher && comment.teacherId !== req.teacher.id) ||
    (req.student && comment.studentId !== req.student.id)
  ) {
    throw new ForbiddenError("You can only update your own comments");
  }

  const updatedComment = await prisma.resourceComment.update({
    where: { id: commentId },
    data: { content },
    include: {
      teacher: {
        select: {
          id: true,
          name: true,
        },
      },
      student: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    message: "Comment updated successfully",
    data: updatedComment,
  });
});

// @desc    Delete resource comment
// @route   DELETE /api/resources/comments/:commentId
// @access  Private (Student/Teacher)
export const deleteResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;

  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  if (
    (req.teacher && comment.teacherId !== req.teacher.id) ||
    (req.student && comment.studentId !== req.student.id)
  ) {
    throw new ForbiddenError("You can only delete your own comments");
  }

  await prisma.resourceComment.delete({
    where: { id: commentId },
  });

  res.status(200).json({
    success: true,
    message: "Comment deleted successfully",
    data: null,
  });
});
