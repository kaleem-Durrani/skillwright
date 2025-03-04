import { Request, Response, NextFunction } from "express";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { ValidationError, AuthenticationError, ForbiddenError, NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import { validationResult } from "express-validator";

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
  
  const [enrollments, total] = await Promise.all([
    prisma.enrollment.findMany({
      where: {
        studentId,
        status: "APPROVED",
      },
      include: {
        course: true,
      },
      skip,
      take: limit,
      orderBy: {
        updatedAt: "desc",
      },
    }),
    prisma.enrollment.count({
      where: {
        studentId,
        status: "APPROVED",
      },
    }),
  ]);

  const courses = enrollments.map((enrollment) => enrollment.course);

  res.status(200).json({
    success: true,
    message: "Enrolled courses retrieved successfully",
    data: {
      items: courses,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    },
  });
});

export const getCourseDetails = asyncHandler(async (req: Request, res: Response) => {
  const courseId = req.params.courseId;

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

  res.status(200).json({
    success: true,
    message: "Course details retrieved successfully",
    data: course
  });
});

export const requestEnrollment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

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

// Assignment Management functionality will be implemented later when the models are added to the schema
