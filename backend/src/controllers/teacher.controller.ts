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

  // Extract query parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string;
  const departmentId = req.query.departmentId as string;

  // Calculate skip value for pagination
  const skip = (page - 1) * limit;

  // Build where clause
  const where: any = { teacherId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (departmentId) {
    where.departmentId = departmentId;
  }

  // Get total count for pagination
  const total = await prisma.course.count({ where });

  // Get courses with pagination
  const courses = await prisma.course.findMany({
    where,
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
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

  // Calculate pagination info
  const totalPages = Math.ceil(total / limit);
  const hasMore = page < totalPages;

  res.status(200).json({
    success: true,
    message: "Courses retrieved successfully",
    data: {
      items: courses,
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

// @desc    Get teacher's resources with pagination
// @route   GET /api/teacher/resources
// @access  Private (Teacher)
export const getMyResources = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher!.id;

  // Extract query parameters
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string;
  const courseId = req.query.courseId as string;
  const type = req.query.type as string;
  const isPublic = req.query.isPublic as string;

  // Calculate skip value for pagination
  const skip = (page - 1) * limit;

  // Build where clause
  const where: any = { teacherId };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (courseId) {
    where.courseId = courseId;
  }

  if (type) {
    where.type = type;
  }

  if (isPublic !== undefined) {
    where.isPublic = isPublic === 'true';
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
    message: "Resources retrieved successfully",
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




