import { Request, Response } from "express";
import { validationResult } from "express-validator";
import prisma from "../db/prisma.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";

// @desc    Get all conversations for the current user (teacher or student)
// @route   GET /api/conversations/teacher or /api/conversations/student
// @access  Private (Teacher/Student)
export const getMyConversations = asyncHandler(async (req: Request, res: Response) => {
  const isTeacher = !!req.teacher;
  const userId = req.teacher?.id || req.student?.id;
  const { page = "1", limit = "20" } = req.query;

  if (!userId) {
    throw new ForbiddenError("User not authenticated");
  }

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Get total count for pagination
  const totalCount = await prisma.conversation.count({
    where: isTeacher
      ? { teacherId: userId }
      : { studentId: userId },
  });

  // Get conversations where user is either teacher or student
  const conversations = await prisma.conversation.findMany({
    where: isTeacher
      ? { teacherId: userId }
      : { studentId: userId },
    include: {
      teacher: {
        select: { id: true, name: true, email: true }
      },
      student: {
        select: { id: true, name: true, email: true }
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          content: true,
          createdAt: true,
          isFromTeacher: true,
          teacherReadAt: true,
          studentReadAt: true,
        }
      },
      _count: {
        select: {
          messages: {
            where: isTeacher
              ? { teacherReadAt: null, isFromTeacher: false }
              : { studentReadAt: null, isFromTeacher: true }
          }
        }
      }
    },
    orderBy: { updatedAt: 'desc' },
    skip: skip,
    take: limitNum
  });

  // Format response
  const formattedConversations = conversations.map(conv => ({
    id: conv.id,
    participant: isTeacher ? conv.student : conv.teacher,
    lastMessage: conv.messages[0] || null,
    unreadCount: conv._count.messages,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }));

  res.status(200).json({
    success: true,
    message: "Conversations retrieved successfully",
    data: {
      conversations: formattedConversations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasMore: pageNum * limitNum < totalCount
      }
    },
  });
});

// @desc    Get messages for a specific conversation with pagination
// @route   GET /api/conversations/teacher/:conversationId/messages or /api/conversations/student/:conversationId/messages
// @access  Private (Teacher/Student)
export const getConversationMessages = async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const { cursor, limit = "20" } = req.query;
  const userId = req.teacher?.id || req.student?.id;

  if (!userId) {
    throw new ForbiddenError("User not authenticated");
  }

  // Verify user has access to this conversation
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { teacherId: userId },
        { studentId: userId }
      ]
    }
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found or access denied");
  }

  // Build pagination query
  const whereClause: any = { conversationId };
  if (cursor) {
    whereClause.id = { lt: cursor };
  }

  const messages = await prisma.message.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit as string),
    select: {
      id: true,
      content: true,
      isFromTeacher: true,
      createdAt: true,
      teacherReadAt: true,
      studentReadAt: true,
    }
  });

  // Get next cursor for pagination
  const nextCursor = messages.length > 0 ? messages[messages.length - 1].id : null;

  res.status(200).json({
    success: true,
    message: "Messages retrieved successfully",
    data: {
      messages: messages.reverse(), // Reverse to show oldest first in UI
      nextCursor,
      hasMore: messages.length === parseInt(limit as string),
    },
  });
};

// @desc    Create a new conversation or get existing one between teacher and student
// @route   POST /api/conversations/teacher/create or /api/conversations/student/create
// @access  Private (Teacher/Student)
export const createOrGetConversation = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { participantId } = req.body; // ID of the other participant
  const isTeacher = !!req.teacher;
  const userId = req.teacher?.id || req.student?.id;

  if (!userId) {
    throw new ForbiddenError("User not authenticated");
  }

  if (!participantId) {
    throw new ValidationError({
      participantId: ["Participant ID is required"],
    });
  }

  // Determine teacher and student IDs
  const teacherId = isTeacher ? userId : participantId;
  const studentId = isTeacher ? participantId : userId;

  // Verify the participant exists and is the correct type
  if (isTeacher) {
    const student = await prisma.student.findUnique({
      where: { id: participantId },
      select: { id: true, name: true, email: true }
    });
    if (!student) {
      throw new NotFoundError("Student not found");
    }
  } else {
    const teacher = await prisma.teacher.findUnique({
      where: { id: participantId },
      select: { id: true, name: true, email: true }
    });
    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }
  }

  // Find existing conversation or create new one using transaction
  const conversation = await prisma.$transaction(async (tx) => {
    let existingConversation = await tx.conversation.findUnique({
      where: {
        teacherId_studentId: {
          teacherId,
          studentId,
        }
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true }
        },
        student: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!existingConversation) {
      existingConversation = await tx.conversation.create({
        data: {
          teacherId,
          studentId,
        },
        include: {
          teacher: {
            select: { id: true, name: true, email: true }
          },
          student: {
            select: { id: true, name: true, email: true }
          }
        }
      });
    }

    return existingConversation;
  });

  res.status(200).json({
    success: true,
    message: "Conversation retrieved successfully",
    data: {
      id: conversation.id,
      participant: isTeacher ? conversation.student : conversation.teacher,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
  });
};

// @desc    Send a message in a conversation
// @route   POST /api/conversations/teacher/:conversationId/messages or /api/conversations/student/:conversationId/messages
// @access  Private (Teacher/Student)
export const sendMessage = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { conversationId } = req.params;
  const { content } = req.body;
  const isTeacher = !!req.teacher;
  const userId = req.teacher?.id || req.student?.id;

  if (!userId) {
    throw new ForbiddenError("User not authenticated");
  }

  if (!content || content.trim().length === 0) {
    throw new ValidationError({
      content: ["Message content is required"],
    });
  }

  // Verify user has access to this conversation
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { teacherId: userId },
        { studentId: userId }
      ]
    }
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found or access denied");
  }

  // Create message and update conversation timestamp using transaction
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        content: content.trim(),
        isFromTeacher: isTeacher,
        // Mark as read by sender immediately
        ...(isTeacher
          ? { teacherReadAt: new Date() }
          : { studentReadAt: new Date() }
        )
      }
    });

    // Update conversation timestamp
    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    return message;
  });

  // Emit WebSocket event for real-time messaging
  const io = req.app.get('io');
  if (io) {
    io.to(`conversation_${conversationId}`).emit('new_message', {
      id: result.id,
      conversationId: conversationId,
      content: result.content,
      isFromTeacher: result.isFromTeacher,
      createdAt: result.createdAt,
      teacherReadAt: result.teacherReadAt,
      studentReadAt: result.studentReadAt,
    });
  }

  res.status(201).json({
    success: true,
    message: "Message sent successfully",
    data: {
      id: result.id,
      content: result.content,
      isFromTeacher: result.isFromTeacher,
      createdAt: result.createdAt,
    },
  });
};

// @desc    Mark messages as read for the current user
// @route   PUT /api/conversations/teacher/:conversationId/read or /api/conversations/student/:conversationId/read
// @access  Private (Teacher/Student)
export const markMessagesAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const isTeacher = !!req.teacher;
  const userId = req.teacher?.id || req.student?.id;

  if (!userId) {
    throw new ForbiddenError("User not authenticated");
  }

  // Verify user has access to this conversation
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [
        { teacherId: userId },
        { studentId: userId }
      ]
    }
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found or access denied");
  }

  // Mark unread messages as read
  const readAt = new Date();
  const updateData = isTeacher
    ? { teacherReadAt: readAt }
    : { studentReadAt: readAt };

  // Get the message IDs that will be updated before updating them
  const messagesToUpdate = await prisma.message.findMany({
    where: {
      conversationId,
      ...(isTeacher
        ? { teacherReadAt: null, isFromTeacher: false }
        : { studentReadAt: null, isFromTeacher: true }
      )
    },
    select: { id: true }
  });

  const result = await prisma.message.updateMany({
    where: {
      conversationId,
      ...(isTeacher
        ? { teacherReadAt: null, isFromTeacher: false }
        : { studentReadAt: null, isFromTeacher: true }
      )
    },
    data: updateData
  });

  // Emit WebSocket event for read receipts if messages were updated
  if (result.count > 0) {
    try {
      const io = req.app.get('io');
      if (io) {
        const eventData = {
          userId,
          userType: isTeacher ? 'teacher' : 'student',
          conversationId,
          messageIds: messagesToUpdate.map(msg => msg.id),
          readAt: readAt.toISOString()
        };
        io.to(`conversation_${conversationId}`).emit('messages_read', eventData);
      }
    } catch (wsError) {
      console.error('WebSocket error:', wsError);
      // Don't throw, just log the error
    }
  }

  res.status(200).json({
    success: true,
    message: "Messages marked as read successfully",
    data: {
      markedAsRead: result.count,
    },
  });
});

// @desc    Get teacher's contacts (students from their courses)
// @route   GET /api/conversations/teacher/contacts
// @access  Private (Teacher)
export const getTeacherContacts = asyncHandler(async (req: Request, res: Response) => {
  const teacherId = req.teacher?.id;

  if (!teacherId) {
    throw new ForbiddenError("Teacher not authenticated");
  }

  // Get all students from courses taught by this teacher
  const students = await prisma.student.findMany({
    where: {
      enrollments: {
        some: {
          course: {
            teacherId: teacherId
          },
          status: 'APPROVED' // Only approved enrollments
        }
      }
    },
    select: {
      id: true,
      name: true,
      email: true,
      enrollmentNo: true,
      department: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      name: 'asc'
    }
  });

  res.status(200).json({
    success: true,
    message: "Teacher contacts retrieved successfully",
    data: students,
  });
});

// @desc    Get student's contacts (teachers from their courses)
// @route   GET /api/conversations/student/contacts
// @access  Private (Student)
export const getStudentContacts = asyncHandler(async (req: Request, res: Response) => {
  const studentId = req.student?.id;

  if (!studentId) {
    throw new ForbiddenError("Student not authenticated");
  }

  // Get all teachers from courses the student is enrolled in
  const teachers = await prisma.teacher.findMany({
    where: {
      courses: {
        some: {
          enrollments: {
            some: {
              studentId: studentId,
              status: 'APPROVED' // Only approved enrollments
            }
          }
        }
      }
    },
    select: {
      id: true,
      name: true,
      email: true,
      qualification: true,
      specialization: true,
      department: {
        select: {
          id: true,
          name: true
        }
      }
    },
    orderBy: {
      name: 'asc'
    }
  });

  res.status(200).json({
    success: true,
    message: "Student contacts retrieved successfully",
    data: teachers,
  });
});