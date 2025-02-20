import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import prisma from "../db/prisma.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";

// @desc    Get teacher profile
// @route   GET /api/teacher/profile
// @access  Private (Teacher)
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          courses: true,
          resources: true,
        },
      },
    },
  });

  if (!teacher) {
    throw new NotFoundError("Teacher not found");
  }

  res.status(200).json({
    success: true,
    message: "Profile retrieved successfully",
    data: teacher,
  });
});

// @desc    Update teacher profile
// @route   PUT /api/teacher/profile
// @access  Private (Teacher)
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const { name, phoneNumber, qualification, specialization } = req.body;

  const teacher = await prisma.teacher.update({
    where: { id: teacherId },
    data: {
      name,
      phoneNumber,
      qualification,
      specialization,
    },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: teacher,
  });
});

// @desc    Get teacher's courses
// @route   GET /api/teacher/courses
// @access  Private (Teacher)
export const getMyCourses = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;

  const courses = await prisma.course.findMany({
    where: { teacherId },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          enrollments: true,
          resources: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    message: "Courses retrieved successfully",
    data: courses,
  });
});

// @desc    Get course details
// @route   GET /api/teacher/courses/:id
// @access  Private (Teacher)
export const getCourseDetails = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const courseId = req.params.id;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      enrollments: {
        include: {
          student: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      resources: {
        include: {
          _count: {
            select: {
              comments: true,
            },
          },
        },
      },
    },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  if (course.teacherId !== teacherId) {
    throw new ForbiddenError("You can only view your own courses");
  }

  res.status(200).json({
    success: true,
    message: "Course details retrieved successfully",
    data: course,
  });
});

// @desc    Get course students
// @route   GET /api/teacher/courses/:id/students
// @access  Private (Teacher)
export const getCourseStudents = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const courseId = req.params.id;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      enrollments: {
        include: {
          student: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
              department: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  if (course.teacherId !== teacherId) {
    throw new ForbiddenError("You can only view students of your own courses");
  }

  res.status(200).json({
    success: true,
    message: "Course students retrieved successfully",
    data: course.enrollments,
  });
});

// @desc    Update enrollment status
// @route   PUT /api/teacher/courses/:courseId/enrollments/:enrollmentId
// @access  Private (Teacher)
export const updateEnrollmentStatus = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const { courseId, enrollmentId } = req.params;
  const { status } = req.body;

  // Using transaction to ensure data consistency
  const enrollment = await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: courseId },
      include: {
        _count: {
          select: {
            enrollments: {
              where: {
                status: "APPROVED",
              },
            },
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenError("You can only manage enrollments of your own courses");
    }

    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundError("Enrollment not found");
    }

    if (enrollment.courseId !== courseId) {
      throw new ValidationError({
        enrollment: ["Enrollment does not belong to this course"],
      });
    }

    // Check capacity if approving
    if (status === "APPROVED" && course._count.enrollments >= course.capacity) {
      throw new ValidationError({
        enrollment: ["Course has reached its capacity"],
      });
    }

    return await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { status },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  });

  res.status(200).json({
    success: true,
    message: `Enrollment ${status.toLowerCase()} successfully`,
    data: enrollment,
  });
});

// @desc    Get course resources
// @route   GET /api/teacher/courses/:id/resources
// @access  Private (Teacher)
export const getCourseResources = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const courseId = req.params.id;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      resources: {
        include: {
          _count: {
            select: {
              comments: true,
            },
          },
        },
      },
    },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  if (course.teacherId !== teacherId) {
    throw new ForbiddenError("You can only view resources of your own courses");
  }

  res.status(200).json({
    success: true,
    message: "Course resources retrieved successfully",
    data: course.resources,
  });
});

// @desc    Create resource
// @route   POST /api/teacher/resources
// @access  Private (Teacher)
export const createResource = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const { title, description, type, url, courseId, isPublic = false } = req.body;

  // Using transaction to ensure data consistency
  const resource = await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenError("You can only create resources for your own courses");
    }

    return await tx.resource.create({
      data: {
        title,
        description,
        type,
        url,
        courseId,
        teacherId,
        isPublic,
      },
    });
  });

  res.status(201).json({
    success: true,
    message: "Resource created successfully",
    data: resource,
  });
});

// @desc    Update resource
// @route   PUT /api/teacher/resources/:id
// @access  Private (Teacher)
export const updateResource = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const resourceId = req.params.id;
  const { title, description, type, url, isPublic } = req.body;

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  if (resource.teacherId !== teacherId) {
    throw new ForbiddenError("You can only update your own resources");
  }

  const updatedResource = await prisma.resource.update({
    where: { id: resourceId },
    data: {
      title,
      description,
      type,
      url,
      isPublic,
    },
  });

  res.status(200).json({
    success: true,
    message: "Resource updated successfully",
    data: updatedResource,
  });
});

// @desc    Delete resource
// @route   DELETE /api/teacher/resources/:id
// @access  Private (Teacher)
export const deleteResource = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const resourceId = req.params.id;

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  if (resource.teacherId !== teacherId) {
    throw new ForbiddenError("You can only delete your own resources");
  }

  await prisma.resource.delete({
    where: { id: resourceId },
  });

  res.status(200).json({
    success: true,
    message: "Resource deleted successfully",
    data: null,
  });
});

// @desc    Get resource comments
// @route   GET /api/teacher/resources/:id/comments
// @access  Private (Teacher)
export const getResourceComments = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const resourceId = req.params.id;

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    include: {
      comments: {
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
          replies: {
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
          },
        },
      },
    },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  if (resource.teacherId !== teacherId) {
    throw new ForbiddenError("You can only view comments of your own resources");
  }

  res.status(200).json({
    success: true,
    message: "Resource comments retrieved successfully",
    data: resource.comments,
  });
});

// @desc    Create resource comment
// @route   POST /api/teacher/resources/:id/comments
// @access  Private (Teacher)
export const createResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const resourceId = req.params.id;
  const { content, parentId } = req.body;

  const comment = await prisma.$transaction(async (tx) => {
    const resource = await tx.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new NotFoundError("Resource not found");
    }

    if (parentId) {
      const parentComment = await tx.resourceComment.findUnique({
        where: { id: parentId },
      });

      if (!parentComment) {
        throw new NotFoundError("Parent comment not found");
      }
    }

    return await tx.resourceComment.create({
      data: {
        content,
        resourceId,
        teacherId,
        parentId,
      },
      include: {
        teacher: {
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
// @route   PUT /api/teacher/resources/comments/:commentId
// @access  Private (Teacher)
export const updateResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const teacherId = req.teacher!.id;
  const commentId = req.params.commentId;
  const { content } = req.body;

  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  if (comment.teacherId !== teacherId) {
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
    },
  });

  res.status(200).json({
    success: true,
    message: "Comment updated successfully",
    data: updatedComment,
  });
});

// @desc    Delete resource comment
// @route   DELETE /api/teacher/resources/comments/:commentId
// @access  Private (Teacher)
export const deleteResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;
  const commentId = req.params.commentId;

  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  if (comment.teacherId !== teacherId) {
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
