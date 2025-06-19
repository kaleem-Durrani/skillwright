import { Request, Response } from "express";
import { validationResult } from "express-validator";
import bcrypt from "bcryptjs";
import prisma from "../db/prisma.js";
import { ValidationError, NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";
import { generateOTP } from "../utils/generateOTP.js";
import { sendVerificationEmail } from "../utils/sendEmail.js";

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
  const { search, departmentId, isBanned, page = '1', limit = '10' } = req.query;

  // Pagination
  const pageNum = parseInt(page as string) || 1;
  const limitNum = parseInt(limit as string) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Build where clause for filtering
  const where: any = {};

  // Search filter (name or email)
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Department filter
  if (departmentId) {
    where.departmentId = departmentId as string;
  }

  // Ban status filter
  if (isBanned !== undefined) {
    where.isBanned = isBanned === 'true';
  }

  // Get teachers and total count in parallel
  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
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
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limitNum,
    }),
    prisma.teacher.count({ where }),
  ]);

  const hasMore = skip + teachers.length < total;

  res.status(200).json({
    success: true,
    message: "Teachers retrieved successfully",
    data: {
      items: teachers,
      total,
      page: pageNum,
      limit: limitNum,
      hasMore,
    },
  });
});

// @desc    Create teacher
// @route   POST /api/admin/teachers
// @access  Private (Admin)
export const createTeacher = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { name, email, password, phoneNumber, qualification, specialization, departmentId } = req.body;

  // Using transaction to ensure data consistency
  const result = await prisma.$transaction(async (tx) => {
    // Check if teacher with email already exists
    const existingTeacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (existingTeacher) {
      throw new ValidationError({
        email: ["Teacher with this email already exists"],
      });
    }

    // Check if department exists
    if (departmentId) {
      const department = await tx.department.findUnique({
        where: { id: departmentId },
      });

      if (!department) {
        throw new ValidationError({
          departmentId: ["Department not found"],
        });
      }
    }

    // Generate OTP for email verification
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create teacher
    const newTeacher = await tx.teacher.create({
      data: {
        email,
        password: hashedPassword,
        name,
        qualification,
        departmentId,
        specialization,
        phoneNumber,
        otp,
        otpExpiry,
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

    // Send OTP email
    try {
      await sendVerificationEmail(email, otp, name);
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      // Don't throw error here, teacher is created successfully
    }

    return newTeacher;
  });

  res.status(201).json({
    success: true,
    message: "Teacher created successfully. Verification email sent.",
    data: result,
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
  const { search, departmentId, isBanned, page = '1', limit = '10' } = req.query;

  // Pagination
  const pageNum = parseInt(page as string) || 1;
  const limitNum = parseInt(limit as string) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Build where clause for filtering
  const where: any = {};

  // Search filter (name or email)
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Department filter
  if (departmentId) {
    where.departmentId = departmentId as string;
  }

  // Ban status filter
  if (isBanned !== undefined) {
    where.isBanned = isBanned === 'true';
  }

  // Get students and total count in parallel
  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
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
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limitNum,
    }),
    prisma.student.count({ where }),
  ]);

  const hasMore = skip + students.length < total;

  res.status(200).json({
    success: true,
    message: "Students retrieved successfully",
    data: {
      items: students,
      total,
      page: pageNum,
      limit: limitNum,
      hasMore,
    },
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
  const { search, type, isPublished, page = '1', limit = '10' } = req.query;

  // Pagination
  const pageNum = parseInt(page as string) || 1;
  const limitNum = parseInt(limit as string) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Build where clause for filtering
  const where: any = {};

  // Search filter (title or content)
  if (search) {
    where.OR = [
      { title: { contains: search as string, mode: 'insensitive' } },
      { content: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  // Type filter
  if (type) {
    where.type = type as string;
  }

  // Published status filter
  if (isPublished !== undefined) {
    where.isPublished = isPublished === 'true';
  }

  // Get news/events and total count in parallel
  const [newsEvents, total] = await Promise.all([
    prisma.newsEvent.findMany({
      where,
      include: {
        _count: {
          select: {
            comments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limitNum,
    }),
    prisma.newsEvent.count({ where }),
  ]);

  const hasMore = skip + newsEvents.length < total;

  res.status(200).json({
    success: true,
    message: "News/events retrieved successfully",
    data: {
      items: newsEvents,
      total,
      page: pageNum,
      limit: limitNum,
      hasMore,
    },
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
