import { Request, Response } from "express";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { NotFoundError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";

// @desc    Get all conversations for the current user
// @route   GET /api/conversations
// @access  Private (Admin, Teacher, Student)
export const getMyConversations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.admin?.id || req.teacher?.id || req.student?.id;
  const userType = req.admin ? "admin" : req.teacher ? "teacher" : "student";

  if (!userId) {
    throw new ForbiddenError("Not authorized");
  }

  // Build the where clause based on user type
  const where: any = {};
  if (userType === "admin") {
    where.adminId = userId;
  } else if (userType === "teacher") {
    where.teacherId = userId;
  } else {
    where.studentId = userId;
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      participants: {
        some: where
      }
    },
    include: {
      participants: {
        include: {
          admin: {
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
          student: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        include: {
          adminSender: {
            select: {
              id: true,
              name: true,
            },
          },
          teacherSender: {
            select: {
              id: true,
              name: true,
            },
          },
          studentSender: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  res.status(200).json({
    success: true,
    message: "Conversations retrieved successfully",
    data: conversations,
  });
});

// @desc    Get a single conversation by ID
// @route   GET /api/conversations/:id
// @access  Private (Admin, Teacher, Student)
export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.admin?.id || req.teacher?.id || req.student?.id;
  const userType = req.admin ? "admin" : req.teacher ? "teacher" : "student";

  if (!userId) {
    throw new ForbiddenError("Not authorized");
  }

  // Build the where clause based on user type
  const where: any = {};
  if (userType === "admin") {
    where.adminId = userId;
  } else if (userType === "teacher") {
    where.teacherId = userId;
  } else {
    where.studentId = userId;
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      participants: {
        some: where
      }
    },
    include: {
      participants: {
        include: {
          admin: {
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
          student: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          adminSender: {
            select: {
              id: true,
              name: true,
            },
          },
          teacherSender: {
            select: {
              id: true,
              name: true,
            },
          },
          studentSender: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found");
  }

  res.status(200).json({
    success: true,
    message: "Conversation retrieved successfully",
    data: conversation,
  });
});

// @desc    Create a new conversation
// @route   POST /api/conversations
// @access  Private (Admin, Teacher, Student)
export const createConversation = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { title, participants, initialMessage } = req.body;
  const userId = req.admin?.id || req.teacher?.id || req.student?.id;
  const userType = req.admin ? "admin" : req.teacher ? "teacher" : "student";

  if (!userId) {
    throw new ForbiddenError("Not authorized");
  }

  // Add current user to participants if not already included
  const currentUserIncluded = participants.some((p: any) => 
    (userType === "admin" && p.adminId === userId) ||
    (userType === "teacher" && p.teacherId === userId) ||
    (userType === "student" && p.studentId === userId)
  );

  if (!currentUserIncluded) {
    participants.push({
      [userType === "admin" ? "adminId" : userType === "teacher" ? "teacherId" : "studentId"]: userId
    });
  }

  // Start transaction
  const conversation = await prisma.$transaction(async (tx) => {
    // Create conversation
    const newConversation = await tx.conversation.create({
      data: {
        title,
        participants: {
          create: participants
        }
      },
      include: {
        participants: true
      }
    });

    // Add initial message if provided
    if (initialMessage) {
      await tx.message.create({
        data: {
          conversationId: newConversation.id,
          content: initialMessage,
          [userType === "admin" ? "adminSenderId" : userType === "teacher" ? "teacherSenderId" : "studentSenderId"]: userId
        }
      });
    }

    return newConversation;
  });

  res.status(201).json({
    success: true,
    message: "Conversation created successfully",
    data: conversation,
  });
});

// @desc    Send a message in a conversation
// @route   POST /api/conversations/:id/messages
// @access  Private (Admin, Teacher, Student)
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id } = req.params;
  const { content } = req.body;
  const userId = req.admin?.id || req.teacher?.id || req.student?.id;
  const userType = req.admin ? "admin" : req.teacher ? "teacher" : "student";

  if (!userId) {
    throw new ForbiddenError("Not authorized");
  }

  // Build the where clause based on user type
  const where: any = {};
  if (userType === "admin") {
    where.adminId = userId;
  } else if (userType === "teacher") {
    where.teacherId = userId;
  } else {
    where.studentId = userId;
  }

  // Check if user is part of the conversation
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      participants: {
        some: where
      }
    }
  });

  if (!conversation) {
    throw new NotFoundError("Conversation not found or you don't have access");
  }

  // Create message
  const message = await prisma.message.create({
    data: {
      conversationId: id,
      content,
      [userType === "admin" ? "adminSenderId" : userType === "teacher" ? "teacherSenderId" : "studentSenderId"]: userId
    },
    include: {
      adminSender: {
        select: {
          id: true,
          name: true,
        },
      },
      teacherSender: {
        select: {
          id: true,
          name: true,
        },
      },
      studentSender: {
        select: {
          id: true,
          name: true,
        },
      },
    }
  });

  // Update conversation's updatedAt
  await prisma.conversation.update({
    where: { id },
    data: { updatedAt: new Date() }
  });

  res.status(201).json({
    success: true,
    message: "Message sent successfully",
    data: message,
  });
});

// @desc    Leave a conversation
// @route   PUT /api/conversations/:id/leave
// @access  Private (Admin, Teacher, Student)
export const leaveConversation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.admin?.id || req.teacher?.id || req.student?.id;
  const userType = req.admin ? "admin" : req.teacher ? "teacher" : "student";

  if (!userId) {
    throw new ForbiddenError("Not authorized");
  }

  // Build the where clause based on user type
  const where: any = {};
  if (userType === "admin") {
    where.adminId = userId;
  } else if (userType === "teacher") {
    where.teacherId = userId;
  } else {
    where.studentId = userId;
  }

  // Find the participant record
  const participant = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId: id,
      ...where
    }
  });

  if (!participant) {
    throw new NotFoundError("You are not part of this conversation");
  }

  // Update the participant record with leftAt timestamp
  await prisma.conversationParticipant.update({
    where: { id: participant.id },
    data: { leftAt: new Date() }
  });

  res.status(200).json({
    success: true,
    message: "Left conversation successfully",
    data: null,
  });
}); 