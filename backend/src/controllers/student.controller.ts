import { Request, Response, NextFunction } from "express";
import prisma from "../db/prisma.js";
import { ValidationError, AuthenticationError, ForbiddenError, NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import { validationResult } from "express-validator";

// Student Profile Management
export const getProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
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

    res.json(student);
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
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
        updatedAt: true,
      },
    });

    res.json(updatedStudent);
  } catch (error) {
    next(error);
  }
};

// Course Management
export const getEnrolledCourses = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.student?.id;
    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId,
        status: "APPROVED",
      },
      select: {
        id: true,
        status: true,
        course: {
          select: {
            id: true,
            name: true,
            description: true,
            teacher: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.json(enrollments);
  } catch (error) {
    next(error);
  }
};

export const getCourseDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const courseId = req.params.courseId;
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        description: true,
        teacher: {
          select: {
            id: true,
            name: true,
          },
        },
        resources: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            url: true,
            createdAt: true,
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundError("Course not found");
    }

    res.json(course);
  } catch (error) {
    next(error);
  }
};

export const requestEnrollment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw parseValidationErrors(errors);
    }

    const studentId = req.student?.id;
    if (!studentId) {
      throw new AuthenticationError("Not authenticated");
    }
    
    const courseId = req.params.courseId;

    // Start transaction
    const enrollment = await prisma.$transaction(async (tx) => {
      // Check if course exists and has capacity
      const course = await tx.course.findUnique({
        where: { id: courseId },
        select: {
          capacity: true,
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

      if (course._count.enrollments >= course.capacity) {
        throw new ForbiddenError("Course has reached its capacity");
      }

      // Check for existing enrollment
      const existingEnrollment = await tx.enrollment.findFirst({
        where: {
          studentId,
          courseId,
        },
      });

      if (existingEnrollment) {
        throw new ForbiddenError("You are already enrolled in this course");
      }

      // Create enrollment
      return await tx.enrollment.create({
        data: {
          studentId,
          courseId,
          status: "PENDING",
        },
        select: {
          id: true,
          status: true,
          course: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    res.status(201).json(enrollment);
  } catch (error) {
    next(error);
  }
};

export const withdrawFromCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.student?.id;
    const courseId = req.params.courseId;

    // Start transaction
    await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.findFirst({
        where: {
          studentId,
          courseId,
        },
      });

      if (!enrollment) {
        throw new NotFoundError("Enrollment not found");
      }

      await tx.enrollment.delete({
        where: {
          id: enrollment.id,
        },
      });
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Resource Management
export const getCourseResources = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const courseId = req.params.courseId;
    const resources = await prisma.resource.findMany({
      where: {
        courseId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        url: true,
        createdAt: true,
        comments: {
          select: {
            id: true,
            content: true,
            createdAt: true,
            student: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.json(resources);
  } catch (error) {
    next(error);
  }
};

export const createResourceComment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw parseValidationErrors(errors);
    }

    const studentId = req.student?.id;
    const resourceId = req.params.resourceId;
    const { content } = req.body;

    // Start transaction
    const comment = await prisma.$transaction(async (tx) => {
      // Check if resource exists
      const resource = await tx.resource.findUnique({
        where: { id: resourceId },
      });

      if (!resource) {
        throw new NotFoundError("Resource not found");
      }

      // Create comment
      return await tx.resourceComment.create({
        data: {
          content,
          studentId,
          resourceId,
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
};

export const updateResourceComment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw parseValidationErrors(errors);
    }

    const studentId = req.student?.id;
    const commentId = req.params.commentId;
    const { content } = req.body;

    // Start transaction
    const updatedComment = await prisma.$transaction(async (tx) => {
      const comment = await tx.resourceComment.findUnique({
        where: { id: commentId },
      });

      if (!comment) {
        throw new NotFoundError("Comment not found");
      }

      if (comment.studentId !== studentId) {
        throw new ForbiddenError("You can only edit your own comments");
      }

      return await tx.resourceComment.update({
        where: { id: commentId },
        data: { content },
        select: {
          id: true,
          content: true,
          updatedAt: true,
          student: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    res.json(updatedComment);
  } catch (error) {
    next(error);
  }
};

export const deleteResourceComment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.student?.id;
    const commentId = req.params.commentId;

    // Start transaction
    await prisma.$transaction(async (tx) => {
      const comment = await tx.resourceComment.findUnique({
        where: { id: commentId },
      });

      if (!comment) {
        throw new NotFoundError("Comment not found");
      }

      if (comment.studentId !== studentId) {
        throw new ForbiddenError("You can only delete your own comments");
      }

      await tx.resourceComment.delete({
        where: { id: commentId },
      });
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// Admin Routes
export const getAllStudents = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const students = await prisma.student.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        isBanned: true,
        createdAt: true,
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    res.json(students);
  } catch (error) {
    next(error);
  }
};

export const getStudentById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.params.id;
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        isBanned: true,
        createdAt: true,
        enrollments: {
          select: {
            id: true,
            status: true,
            course: {
              select: {
                id: true,
                name: true,
                teacher: {
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

    if (!student) {
      throw new NotFoundError("Student not found");
    }

    res.json(student);
  } catch (error) {
    next(error);
  }
};

export const toggleStudentBan = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.params.id;

    // Start transaction
    const updatedStudent = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
      });

      if (!student) {
        throw new NotFoundError("Student not found");
      }

      return await tx.student.update({
        where: { id: studentId },
        data: {
          isBanned: !student.isBanned,
        },
        select: {
          id: true,
          name: true,
          email: true,
          isBanned: true,
        },
      });
    });

    res.json(updatedStudent);
  } catch (error) {
    next(error);
  }
};

export const deleteStudent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.params.id;

    // Start transaction
    await prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
      });

      if (!student) {
        throw new NotFoundError("Student not found");
      }

      // Delete all related records first
      await tx.resourceComment.deleteMany({
        where: { studentId },
      });

      await tx.newsEventComment.deleteMany({
        where: { studentId },
      });

      await tx.enrollment.deleteMany({
        where: { studentId },
      });

      await tx.conversationParticipant.deleteMany({
        where: { studentId },
      });

      await tx.message.deleteMany({
        where: { studentSenderId: studentId },
      });

      // Finally, delete the student
      await tx.student.delete({
        where: { id: studentId },
      });
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
