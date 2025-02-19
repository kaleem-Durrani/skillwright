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
    const courseId = req.params.courseId;

    const existingEnrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
      },
    });

    if (existingEnrollment) {
      throw new ForbiddenError("You are already enrolled in this course");
    }

    const enrollment = await prisma.enrollment.create({
      data: {
        studentId: studentId!,
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

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
      },
    });

    if (!enrollment) {
      throw new NotFoundError("Enrollment not found");
    }

    await prisma.enrollment.delete({
      where: {
        id: enrollment.id,
      },
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

    const comment = await prisma.resourceComment.create({
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

    const comment = await prisma.resourceComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundError("Comment not found");
    }

    if (comment.studentId !== studentId) {
      throw new ForbiddenError("You can only edit your own comments");
    }

    const updatedComment = await prisma.resourceComment.update({
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

    const comment = await prisma.resourceComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundError("Comment not found");
    }

    if (comment.studentId !== studentId) {
      throw new ForbiddenError("You can only delete your own comments");
    }

    await prisma.resourceComment.delete({
      where: { id: commentId },
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
    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundError("Student not found");
    }

    const updatedStudent = await prisma.student.update({
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
    const student = await prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new NotFoundError("Student not found");
    }

    await prisma.student.delete({
      where: { id: studentId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
