import { Request, Response, NextFunction } from "express";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { ValidationError, AuthenticationError, ForbiddenError, NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import { validationResult } from "express-validator";

// Dashboard
export const getDashboardStats = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;

  if (!studentId) {
    throw new AuthenticationError("Student not authenticated");
  }

  // Get dashboard statistics
  const [
    enrolledCoursesCount,
    pendingRequestsCount,
    recentCourses,
    recentResources,
    recentNews
  ] = await Promise.all([
    // Count of enrolled courses
    prisma.enrollment.count({
      where: {
        studentId,
        status: "APPROVED",
      },
    }),

    // Count of pending enrollment requests
    prisma.enrollment.count({
      where: {
        studentId,
        status: "PENDING",
      },
    }),

    // Recent enrolled courses (last 5)
    prisma.enrollment.findMany({
      where: {
        studentId,
        status: "APPROVED",
      },
      include: {
        course: {
          include: {
            teacher: {
              select: {
                id: true,
                name: true,
              },
            },
            department: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 5,
    }),

    // Recent resources from enrolled courses (last 10)
    prisma.resource.findMany({
      where: {
        OR: [
          { isPublic: true },
          {
            course: {
              enrollments: {
                some: {
                  studentId,
                  status: "APPROVED",
                },
              },
            },
          },
        ],
      },
      include: {
        course: {
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
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),

    // Recent news and events (last 5)
    prisma.newsEvent.findMany({
      where: {
        isPublished: true,
      },
      orderBy: {
        date: "desc",
      },
      take: 5,
    }),
  ]);

  const dashboardData = {
    stats: {
      enrolledCourses: enrolledCoursesCount,
      pendingRequests: pendingRequestsCount,
      totalResources: recentResources.length,
    },
    recentCourses: recentCourses.map(enrollment => enrollment.course),
    recentResources,
    recentNews,
  };

  res.status(200).json({
    success: true,
    message: "Dashboard data retrieved successfully",
    data: dashboardData,
  });
});

// Student Profile Management
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;
  
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      createdAt: true,
      updatedAt: true,
      isVerified: true,
      isBanned: true,
      enrollments: {
        select: {
          id: true,
          status: true,
          course: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
        },
      },
    },
  });

  if (!student) {
    throw new NotFoundError("Student not found");
  }

  res.status(200).json({
    success: true,
    message: "Student profile retrieved successfully",
    data: student
  });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const studentId = req.student?.id;
  const { name, phoneNumber } = req.body;

  const updatedStudent = await prisma.student.update({
    where: { id: studentId },
    data: {
      name,
      phoneNumber,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phoneNumber: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: updatedStudent
  });
});

// Course Management
export const getEnrolledCourses = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search as string;

  // Build where clause
  const where: any = {
    studentId,
    status: "APPROVED",
  };

  if (search) {
    where.course = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      include: {
        course: {
          include: {
            teacher: {
              select: {
                id: true,
                name: true,
              },
            },
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
        },
      },
      skip,
      take: limit,
      orderBy: {
        updatedAt: "desc",
      },
    }),
    prisma.enrollment.count({ where }),
  ]);

  const courses = enrollments.map((enrollment) => ({
    ...enrollment.course,
    enrollmentId: enrollment.id,
    enrolledAt: enrollment.enrolledAt,
  }));

  res.status(200).json({
    success: true,
    message: "Enrolled courses retrieved successfully",
    data: {
      items: courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    },
  });
});

export const getPendingRequests = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search as string;

  // Build where clause
  const where: any = {
    studentId,
    status: "PENDING",
  };

  if (search) {
    where.course = {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where,
      include: {
        course: {
          include: {
            teacher: {
              select: {
                id: true,
                name: true,
              },
            },
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
        },
      },
      skip,
      take: limit,
      orderBy: {
        enrolledAt: "desc",
      },
    }),
    prisma.enrollment.count({ where }),
  ]);

  const requests = enrollments.map((enrollment) => ({
    ...enrollment.course,
    enrollmentId: enrollment.id,
    requestedAt: enrollment.enrolledAt,
    status: enrollment.status,
  }));

  res.status(200).json({
    success: true,
    message: "Pending requests retrieved successfully",
    data: {
      items: requests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    },
  });
});

export const getAvailableCourses = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;

  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search as string;

  // Build where clause for courses
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      include: {
        teacher: {
          select: {
            id: true,
            name: true,
          },
        },
        department: {
          select: {
            id: true,
            name: true,
          },
        },
        enrollments: {
          where: {
            studentId,
          },
          select: {
            id: true,
            status: true,
          },
        },
        _count: {
          select: {
            enrollments: {
              where: {
                status: "APPROVED",
              },
            },
            resources: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.course.count({ where }),
  ]);

  // Add enrollment status for each course
  const coursesWithStatus = courses.map((course) => {
    const enrollment = course.enrollments[0];
    return {
      ...course,
      enrollments: undefined, // Remove enrollments array from response
      enrollmentStatus: enrollment?.status || null,
      enrollmentId: enrollment?.id || null,
      canEnroll: !enrollment, // Can enroll if no existing enrollment
    };
  });

  res.status(200).json({
    success: true,
    message: "Available courses retrieved successfully",
    data: {
      items: coursesWithStatus,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    },
  });
});

export const cancelEnrollmentRequest = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;
  const enrollmentId = req.params.enrollmentId;

  if (!studentId) {
    throw new AuthenticationError("Student not authenticated");
  }

  // Check if enrollment exists and belongs to the student
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      id: enrollmentId,
      studentId,
      status: "PENDING",
    },
  });

  if (!enrollment) {
    throw new NotFoundError("Pending enrollment request not found");
  }

  // Delete the enrollment request
  await prisma.enrollment.delete({
    where: { id: enrollmentId },
  });

  res.status(200).json({
    success: true,
    message: "Enrollment request cancelled successfully",
    data: null,
  });
});

export const getCourseDetails = asyncHandler(async (req: Request, res: Response) => {
  const courseId = req.params.courseId;
  const studentId = req.student?.id;

  if (!studentId) {
    throw new AuthenticationError("Student not authenticated");
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      teacher: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      resources: {
        where: {
          isPublic: true,
        },
        select: {
          id: true,
          title: true,
          type: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
      },
      enrollments: {
        where: {
          studentId,
        },
        select: {
          id: true,
          status: true,
        },
      },
      _count: {
        select: {
          enrollments: {
            where: {
              status: "APPROVED",
            },
          },
          resources: true,
        },
      },
    },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  // Add enrollment status to the response
  const enrollment = course.enrollments[0];
  const courseWithStatus = {
    ...course,
    enrollmentStatus: enrollment?.status || null,
    enrollmentId: enrollment?.id || null,
    enrollments: undefined, // Remove the enrollments array from response
  };

  res.status(200).json({
    success: true,
    message: "Course details retrieved successfully",
    data: courseWithStatus
  });
});

export const requestEnrollment = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;
  if (!studentId) {
    throw new AuthenticationError("Not authenticated");
  }

  const courseId = req.params.courseId;

  // Check if course exists
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  if (!course) {
    throw new NotFoundError("Course not found");
  }

  // Check if already enrolled
  const existingEnrollment = await prisma.enrollment.findFirst({
    where: {
      studentId,
      courseId,
    },
  });

  if (existingEnrollment) {
    throw new ValidationError({
      enrollment: ["You are already enrolled or have a pending enrollment request for this course"],
    });
  }

  // Check if course has capacity
  const enrollmentCount = await prisma.enrollment.count({
    where: {
      courseId,
      status: "APPROVED",
    },
  });

  if (course.capacity && enrollmentCount >= course.capacity) {
    throw new ValidationError({
      enrollment: ["Course has reached its maximum capacity"],
    });
  }

  // Create enrollment
  const enrollment = await prisma.enrollment.create({
    data: {
      studentId,
      courseId,
      status: "PENDING",
    },
  });

  res.status(201).json({
    success: true,
    message: "Enrollment request submitted successfully",
    data: enrollment
  });
});

export const withdrawFromCourse = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;
  if (!studentId) {
    throw new AuthenticationError("Not authenticated");
  }
  
  const courseId = req.params.courseId;

  // Check if enrollment exists
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      studentId,
      courseId,
    },
  });

  if (!enrollment) {
    throw new NotFoundError("You are not enrolled in this course");
  }

  // Update enrollment status
  const updatedEnrollment = await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: {
      status: "WITHDRAWN",
    },
  });

  res.status(200).json({
    success: true,
    message: "Successfully withdrawn from the course",
    data: updatedEnrollment
  });
});

// Resource Management
export const getCourseResources = asyncHandler(async (req: Request, res: Response) => {
  const courseId = req.params.courseId;
  
  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where: {
        courseId,
        OR: [
          { isPublic: true },
          { isPublic: false, course: { enrollments: { some: { studentId: req.student?.id, status: "APPROVED" } } } },
        ],
      },
      include: {
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
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.resource.count({
      where: {
        courseId,
        OR: [
          { isPublic: true },
          { isPublic: false, course: { enrollments: { some: { studentId: req.student?.id, status: "APPROVED" } } } },
        ],
      },
    }),
  ]);

  res.status(200).json({
    success: true,
    message: "Course resources retrieved successfully",
    data: {
      items: resources,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    },
  });
});

export const createResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const resourceId = req.params.resourceId;
  const { content } = req.body;
  
  if (!req.student?.id) {
    throw new AuthenticationError("Student not authenticated");
  }
  
  // Check if resource exists
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
  });
  
  if (!resource) {
    throw new NotFoundError("Resource not found");
  }
  
  // Check if student is enrolled in the course
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      studentId: req.student.id,
      courseId: resource.courseId,
      status: "APPROVED",
    },
  });
  
  if (!enrollment && !resource.isPublic) {
    throw new ForbiddenError("You are not enrolled in this course");
  }
  
  const comment = await prisma.resourceComment.create({
    data: {
      content,
      resourceId,
      studentId: req.student.id,
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  
  res.status(201).json({
    success: true,
    message: "Comment created successfully",
    data: comment,
  });
});

export const updateResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const commentId = req.params.commentId;
  const { content } = req.body;
  
  if (!req.student?.id) {
    throw new AuthenticationError("Student not authenticated");
  }
  
  // Check if comment exists and belongs to the student
  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });
  
  if (!comment) {
    throw new NotFoundError("Comment not found");
  }
  
  if (comment.studentId !== req.student.id) {
    throw new ForbiddenError("You can only update your own comments");
  }
  
  const updatedComment = await prisma.resourceComment.update({
    where: { id: commentId },
    data: { content },
    include: {
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

export const deleteResourceComment = asyncHandler(async (req: Request, res: Response) => {
  const commentId = req.params.commentId;
  
  if (!req.student?.id) {
    throw new AuthenticationError("Student not authenticated");
  }
  
  // Check if comment exists and belongs to the student
  const comment = await prisma.resourceComment.findUnique({
    where: { id: commentId },
  });
  
  if (!comment) {
    throw new NotFoundError("Comment not found");
  }
  
  if (comment.studentId !== req.student.id) {
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

export const getResourceDetails = asyncHandler(async (req: Request, res: Response) => {
  const resourceId = req.params.resourceId;

  if (!req.student?.id) {
    throw new AuthenticationError("Student not authenticated");
  }

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
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

  // Check if student has access to this resource
  if (!resource.isPublic) {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: req.student.id,
        courseId: resource.courseId,
        status: "APPROVED",
      },
    });

    if (!enrollment) {
      throw new ForbiddenError("You do not have access to this resource");
    }
  }

  res.status(200).json({
    success: true,
    message: "Resource details retrieved successfully",
    data: resource,
  });
});

export const getResourceComments = asyncHandler(async (req: Request, res: Response) => {
  const resourceId = req.params.resourceId;
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!req.student?.id) {
    throw new AuthenticationError("Student not authenticated");
  }

  // Check if resource exists and student has access
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      isPublic: true,
      courseId: true,
    },
  });

  if (!resource) {
    throw new NotFoundError("Resource not found");
  }

  // Check access for private resources
  if (!resource.isPublic) {
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: req.student.id,
        courseId: resource.courseId,
        status: "APPROVED",
      },
    });

    if (!enrollment) {
      throw new ForbiddenError("You do not have access to this resource");
    }
  }

  const [comments, total] = await Promise.all([
    prisma.resourceComment.findMany({
      where: {
        resourceId,
        parentId: null, // Only top-level comments for now
      },
      include: {
        student: {
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
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: Number(limit),
    }),
    prisma.resourceComment.count({
      where: {
        resourceId,
        parentId: null,
      },
    }),
  ]);

  res.status(200).json({
    success: true,
    message: "Resource comments retrieved successfully",
    data: {
      items: comments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
        hasMore: skip + Number(limit) < total,
      },
    },
  });
});

export const getAllPublicResources = asyncHandler(async (req: Request, res: Response) => {
  // Pagination
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search as string;
  const type = req.query.type as string;

  // Build where clause
  const where: any = {
    isPublic: true,
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { course: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  if (type) {
    where.type = type;
  }

  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where,
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
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.resource.count({ where }),
  ]);

  res.status(200).json({
    success: true,
    message: "Public resources retrieved successfully",
    data: {
      items: resources,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    },
  });
});

// Assignment Management functionality will be implemented later when the models are added to the schema
