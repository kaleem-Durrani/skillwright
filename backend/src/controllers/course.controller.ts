import { Request, Response } from "express";
import { validationResult } from "express-validator";
import prisma from "../db/prisma.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";

// @desc    Get all courses
// @route   GET /api/course
// @access  Public
export const getAllCourses = asyncHandler(async (req: Request, res: Response) => {
  const courses = await prisma.course.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      duration: true,
      capacity: true,
      startDate: true,
      endDate: true,
      department: {
        select: {
          id: true,
          name: true,
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

// @desc    Get public courses with pagination and filtering
// @route   GET /api/course/public
// @access  Public
export const getPublicCourses = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const search = req.query.search as string;
  const departmentId = req.query.departmentId as string;
  const skip = (page - 1) * limit;

  // Build where clause for filtering
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (departmentId) {
    where.departmentId = departmentId;
  }

  // Get total count for pagination
  const totalCourses = await prisma.course.count({ where });

  // Get courses with detailed information
  const courses = await prisma.course.findMany({
    where,
    skip,
    take: limit,
    select: {
      id: true,
      name: true,
      code: true,
      description: true,
      duration: true,
      capacity: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      department: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      teacher: {
        select: {
          id: true,
          name: true,
          email: true,
          qualification: true,
          specialization: true,
        },
      },
      _count: {
        select: {
          enrollments: {
            where: {
              status: 'APPROVED'
            }
          },
          resources: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Calculate pagination info
  const totalPages = Math.ceil(totalCourses / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  res.status(200).json({
    success: true,
    message: "Public courses retrieved successfully",
    data: courses,
    pagination: {
      currentPage: page,
      totalPages,
      totalCourses,
      hasNextPage,
      hasPrevPage,
      limit,
    },
  });
});

// @desc    Get single course
// @route   GET /api/course/:id
// @access  Public
export const getCourse = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      teacher: {
        select: {
          id: true,
          name: true,
          qualification: true,
          specialization: true,
        },
      },
      resources: {
        where: {
          isPublic: true,
        },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          enrollments: true,
        },
      },
    },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  res.status(200).json({
    success: true,
    message: "Course retrieved successfully",
    data: course,
  });
});

// @desc    Create new course
// @route   POST /api/course
// @access  Private (Teacher)
export const createCourse = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { name, code, description, duration, capacity, departmentId, syllabus, startDate, endDate } = req.body;

  // Using transaction to ensure data consistency
  const course = await prisma.$transaction(async (tx) => {
    // Check if course with same code exists
    const existingCourse = await tx.course.findUnique({
      where: { code },
    });

    if (existingCourse) {
      throw new ValidationError({
        code: ["Course with this code already exists"],
      });
    }

    return await tx.course.create({
      data: {
        name,
        code,
        description,
        duration,
        capacity: capacity || 30,
        departmentId,
        teacherId: req.teacher!.id,
        syllabus,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
      include: {
        department: {
          select: {
            name: true,
          },
        },
      },
    });
  });

  res.status(201).json({
    success: true,
    message: "Course created successfully",
    data: course,
  });
});

// @desc    Update course
// @route   PUT /api/course/:id
// @access  Private (Teacher)
export const updateCourse = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id } = req.params;
  const { name, code, description, duration, capacity, syllabus, startDate, endDate, departmentId } = req.body;

  // Using transaction to ensure data consistency
  const course = await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    if (course.teacherId !== req.teacher!.id) {
      throw new ForbiddenError("You can only update your own courses");
    }

    // If code is being updated, check for uniqueness
    if (code && code !== course.code) {
      const existingCourse = await tx.course.findUnique({
        where: { code },
      });

      if (existingCourse) {
        throw new ValidationError({
          code: ["Course with this code already exists"],
        });
      }
    }

    return await tx.course.update({
      where: { id },
      data: {
        name,
        code,
        description,
        duration,
        capacity,
        syllabus,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        departmentId,
      },
    });
  });

  res.status(200).json({
    success: true,
    message: "Course updated successfully",
    data: course,
  });
});

// @desc    Delete course
// @route   DELETE /api/course/:id
// @access  Private (Teacher)
export const deleteCourse = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Using transaction to ensure data consistency
  await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            enrollments: true,
            resources: true,
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    if (course.teacherId !== req.teacher!.id) {
      throw new ForbiddenError("You can only delete your own courses");
    }

    // Check if course has any enrollments or resources
    if (course._count.enrollments > 0 || course._count.resources > 0) {
      throw new ValidationError({
        course: ["Cannot delete course with active enrollments or resources"],
      });
    }

    await tx.course.delete({
      where: { id },
    });
  });

  res.status(200).json({
    success: true,
    message: "Course deleted successfully",
    data: null,
  });
});

// @desc    Get course resources
// @route   GET /api/course/:id/resources
// @access  Private (Teacher)
export const getCourseResources = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      teacherId: true,
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

  if (course.teacherId !== req.teacher!.id) {
    throw new ForbiddenError("You can only view resources of your own courses");
  }

  res.status(200).json({
    success: true,
    message: "Course resources retrieved successfully",
    data: course.resources,
  });
});

// @desc    Get enrolled students
// @route   GET /api/course/:id/students
// @access  Private (Teacher)
export const getEnrolledStudents = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      teacherId: true,
      enrollments: {
        where: {
          status: "APPROVED",
        },
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

  if (course.teacherId !== req.teacher!.id) {
    throw new ForbiddenError("You can only view students of your own courses");
  }

  res.status(200).json({
    success: true,
    message: "Enrolled students retrieved successfully",
    data: course.enrollments,
  });
});

// @desc    Update enrollment status
// @route   PUT /api/course/:id/enrollments/:enrollmentId
// @access  Private (Teacher)
export const updateEnrollmentStatus = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id, enrollmentId } = req.params;
  const { status } = req.body;

  // Using transaction to ensure data consistency
  const enrollment = await prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id },
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

    if (course.teacherId !== req.teacher!.id) {
      throw new ForbiddenError("You can only manage enrollments of your own courses");
    }

    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      throw new NotFoundError("Enrollment not found");
    }

    if (enrollment.courseId !== id) {
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