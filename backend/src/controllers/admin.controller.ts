import { Request, Response } from "express";
import { validationResult } from "express-validator";
import prisma from "../db/prisma.js";
import { ValidationError, NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";

// @desc    Get admin profile
// @route   GET /api/admin/profile
// @access  Private (Admin)
export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.admin!.id;

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
  });

  if (!admin) {
    throw new NotFoundError("Admin not found");
  }

  res.status(200).json({
    success: true,
    message: "Profile retrieved successfully",
    data: admin,
  });
});

// @desc    Update admin profile
// @route   PUT /api/admin/profile
// @access  Private (Admin)
export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const adminId = req.admin!.id;
  const { name, phoneNumber } = req.body;

  const admin = await prisma.admin.update({
    where: { id: adminId },
    data: {
      name,
      phoneNumber,
    },
  });

  res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: admin,
  });
});

// @desc    Get all teachers
// @route   GET /api/admin/teachers
// @access  Private (Admin)
export const getAllTeachers = asyncHandler(async (req: Request, res: Response) => {
  const teachers = await prisma.teacher.findMany({
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

  res.status(200).json({
    success: true,
    message: "Teachers retrieved successfully",
    data: teachers,
  });
});

// @desc    Get teacher by ID
// @route   GET /api/admin/teachers/:id
// @access  Private (Admin)
export const getTeacherById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const teacher = await prisma.teacher.findUnique({
    where: { id },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      courses: {
        select: {
          id: true,
          name: true,
          code: true,
          _count: {
            select: {
              enrollments: true,
              resources: true,
            },
          },
        },
      },
      resources: {
        select: {
          id: true,
          title: true,
          type: true,
          course: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!teacher) {
    throw new NotFoundError("Teacher not found");
  }

  res.status(200).json({
    success: true,
    message: "Teacher retrieved successfully",
    data: teacher,
  });
});

// @desc    Toggle teacher ban status
// @route   PUT /api/admin/teachers/:id/ban
// @access  Private (Admin)
export const toggleTeacherBan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const teacher = await prisma.teacher.findUnique({
    where: { id },
  });

  if (!teacher) {
    throw new NotFoundError("Teacher not found");
  }

  const updatedTeacher = await prisma.teacher.update({
    where: { id },
    data: {
      isBanned: !teacher.isBanned,
    },
  });

  res.status(200).json({
    success: true,
    message: `Teacher ${updatedTeacher.isBanned ? "banned" : "unbanned"} successfully`,
    data: updatedTeacher,
  });
});

// @desc    Delete teacher
// @route   DELETE /api/admin/teachers/:id
// @access  Private (Admin)
export const deleteTeacher = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Using transaction to ensure data consistency
  await prisma.$transaction(async (tx) => {
    const teacher = await tx.teacher.findUnique({
      where: { id },
      include: {
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

    if (teacher._count.courses > 0 || teacher._count.resources > 0) {
      throw new ValidationError({
        teacher: ["Cannot delete teacher with active courses or resources"],
      });
    }

    await tx.teacher.delete({
      where: { id },
    });
  });

  res.status(200).json({
    success: true,
    message: "Teacher deleted successfully",
    data: null,
  });
});

// @desc    Get all students
// @route   GET /api/admin/students
// @access  Private (Admin)
export const getAllStudents = asyncHandler(async (req: Request, res: Response) => {
  const students = await prisma.student.findMany({
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
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    message: "Students retrieved successfully",
    data: students,
  });
});

// @desc    Get student by ID
// @route   GET /api/admin/students/:id
// @access  Private (Admin)
export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      department: {
        select: {
          id: true,
          name: true,
        },
      },
      enrollments: {
        include: {
          course: {
            select: {
              id: true,
              name: true,
              code: true,
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

  res.status(200).json({
    success: true,
    message: "Student retrieved successfully",
    data: student,
  });
});

// @desc    Toggle student ban status
// @route   PUT /api/admin/students/:id/ban
// @access  Private (Admin)
export const toggleStudentBan = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const student = await prisma.student.findUnique({
    where: { id },
  });

  if (!student) {
    throw new NotFoundError("Student not found");
  }

  const updatedStudent = await prisma.student.update({
    where: { id },
    data: {
      isBanned: !student.isBanned,
    },
  });

  res.status(200).json({
    success: true,
    message: `Student ${updatedStudent.isBanned ? "banned" : "unbanned"} successfully`,
    data: updatedStudent,
  });
});

// @desc    Delete student
// @route   DELETE /api/admin/students/:id
// @access  Private (Admin)
export const deleteStudent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Using transaction to ensure data consistency
  await prisma.$transaction(async (tx) => {
    const student = await tx.student.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    if (!student) {
      throw new NotFoundError("Student not found");
    }

    if (student._count.enrollments > 0) {
      throw new ValidationError({
        student: ["Cannot delete student with active enrollments"],
      });
    }

    await tx.student.delete({
      where: { id },
    });
  });

  res.status(200).json({
    success: true,
    message: "Student deleted successfully",
    data: null,
  });
});

// @desc    Get all news/events
// @route   GET /api/admin/news
// @access  Private (Admin)
export const getAllNewsEvents = asyncHandler(async (req: Request, res: Response) => {
  const newsEvents = await prisma.newsEvent.findMany({
    include: {
      _count: {
        select: {
          comments: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    message: "News/events retrieved successfully",
    data: newsEvents,
  });
});

// @desc    Get news/event by ID
// @route   GET /api/admin/news/:id
// @access  Private (Admin)
export const getNewsEvent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const newsEvent = await prisma.newsEvent.findUnique({
    where: { id },
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
        },
      },
    },
  });

  if (!newsEvent) {
    throw new NotFoundError("News/event not found");
  }

  res.status(200).json({
    success: true,
    message: "News/event retrieved successfully",
    data: newsEvent,
  });
});

// @desc    Create news/event
// @route   POST /api/admin/news
// @access  Private (Admin)
export const createNewsEvent = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { title, content, type, date, isPublished = false } = req.body;

  const newsEvent = await prisma.newsEvent.create({
    data: {
      title,
      content,
      type,
      date: new Date(date),
      isPublished,
    },
  });

  res.status(201).json({
    success: true,
    message: "News/event created successfully",
    data: newsEvent,
  });
});

// @desc    Update news/event
// @route   PUT /api/admin/news/:id
// @access  Private (Admin)
export const updateNewsEvent = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id } = req.params;
  const { title, content, type } = req.body;

  const newsEvent = await prisma.newsEvent.findUnique({
    where: { id },
  });

  if (!newsEvent) {
    throw new NotFoundError("News/event not found");
  }

  const updatedNewsEvent = await prisma.newsEvent.update({
    where: { id },
    data: {
      title,
      content,
      type,
    },
  });

  res.status(200).json({
    success: true,
    message: "News/event updated successfully",
    data: updatedNewsEvent,
  });
});

// @desc    Delete news/event
// @route   DELETE /api/admin/news/:id
// @access  Private (Admin)
export const deleteNewsEvent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Using transaction to ensure data consistency
  await prisma.$transaction(async (tx) => {
    const newsEvent = await tx.newsEvent.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            comments: true,
          },
        },
      },
    });

    if (!newsEvent) {
      throw new NotFoundError("News/event not found");
    }

    if (newsEvent._count.comments > 0) {
      throw new ValidationError({
        newsEvent: ["Cannot delete news/event with comments"],
      });
    }

    await tx.newsEvent.delete({
      where: { id },
    });
  });

  res.status(200).json({
    success: true,
    message: "News/event deleted successfully",
    data: null,
  });
});

// @desc    Toggle news/event publish status
// @route   PUT /api/admin/news/:id/publish
// @access  Private (Admin)
export const toggleNewsEventPublish = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const newsEvent = await prisma.newsEvent.findUnique({
    where: { id },
  });

  if (!newsEvent) {
    throw new NotFoundError("News/event not found");
  }

  const updatedNewsEvent = await prisma.newsEvent.update({
    where: { id },
    data: {
      isPublished: !newsEvent.isPublished,
    },
  });

  res.status(200).json({
    success: true,
    message: `News/event ${updatedNewsEvent.isPublished ? "published" : "unpublished"} successfully`,
    data: updatedNewsEvent,
  });
});
