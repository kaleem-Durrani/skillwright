import { Request, Response } from "express";
import { validationResult } from "express-validator";
import prisma from "../db/prisma.js";
import { NotFoundError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import asyncHandler from "../middleware/asyncHandler.js";

/**
 * News & Events Controller
 * 
 * This file contains controllers for public news and events functionality:
 * - Get all published news/events
 * - Get a specific published news/event
 * - Get comments for a news/event
 * - Add a comment to a news/event
 * - Update own comment
 * - Delete own comment
 */

// @desc    Get all published news/events
// @route   GET /api/news-events
// @access  Public
export const getAllPublishedNewsEvents = asyncHandler(async (req: Request, res: Response) => {
  const newsEvents = await prisma.newsEvent.findMany({
    where: {
      isPublished: true,
    },
    orderBy: {
      date: 'desc',
    },
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
    message: "Published news/events retrieved successfully",
    data: newsEvents,
  });
});

// @desc    Get news/event by ID
// @route   GET /api/news-events/:id
// @access  Public
export const getPublishedNewsEvent = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const newsEvent = await prisma.newsEvent.findUnique({
    where: { 
      id,
      isPublished: true,
    },
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
        where: {
          parentId: null, // Only get top-level comments
        },
        orderBy: {
          createdAt: 'desc',
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

// @desc    Get comments for a news/event
// @route   GET /api/news-events/:id/comments
// @access  Public
export const getNewsEventComments = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const newsEvent = await prisma.newsEvent.findUnique({
    where: { 
      id,
      isPublished: true,
    },
    select: {
      id: true,
    },
  });

  if (!newsEvent) {
    throw new NotFoundError("News/event not found");
  }

  const comments = await prisma.newsEventComment.findMany({
    where: {
      newsEventId: id,
      parentId: null, // Only get top-level comments
    },
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
      // Note: Nested comments functionality is currently disabled
      // _count: {
      //   select: {
      //     replies: true,
      //   },
      // },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.status(200).json({
    success: true,
    message: "Comments retrieved successfully",
    data: comments,
  });
});

// @desc    Create a comment on a news/event
// @route   POST /api/news-events/:id/comments
// @access  Private (Student or Teacher)
export const createNewsEventComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { id } = req.params;
  const { content } = req.body;

  // Check if news/event exists and is published
  const newsEvent = await prisma.newsEvent.findUnique({
    where: { 
      id,
      isPublished: true,
    },
    select: {
      id: true,
    },
  });

  if (!newsEvent) {
    throw new NotFoundError("News/event not found");
  }

  // Determine if comment is from student or teacher
  let commentData: any = {
    content,
    newsEventId: id,
  };

  if (req.student) {
    commentData.studentId = req.student.id;
  } else if (req.teacher) {
    commentData.teacherId = req.teacher.id;
  } else {
    res.status(401);
    throw new Error("Not authorized");
  }

  // Create comment using transaction
  const comment = await prisma.$transaction(async (tx) => {
    return await tx.newsEventComment.create({
      data: commentData,
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
    });
  });

  res.status(201).json({
    success: true,
    message: "Comment created successfully",
    data: comment,
  });
});

// @desc    Update own comment
// @route   PUT /api/news-events/comments/:commentId
// @access  Private (Student or Teacher)
export const updateNewsEventComment = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { commentId } = req.params;
  const { content } = req.body;

  // Find the comment
  const comment = await prisma.newsEventComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  // Check ownership
  let isOwner = false;
  if (req.student && comment.studentId === req.student.id) {
    isOwner = true;
  } else if (req.teacher && comment.teacherId === req.teacher.id) {
    isOwner = true;
  }

  if (!isOwner) {
    res.status(403);
    throw new Error("Not authorized to update this comment");
  }

  // Update the comment
  const updatedComment = await prisma.newsEventComment.update({
    where: { id: commentId },
    data: { content },
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
  });

  res.status(200).json({
    success: true,
    message: "Comment updated successfully",
    data: updatedComment,
  });
});

// @desc    Delete own comment
// @route   DELETE /api/news-events/comments/:commentId
// @access  Private (Student or Teacher)
export const deleteNewsEventComment = asyncHandler(async (req: Request, res: Response) => {
  const { commentId } = req.params;

  // Find the comment
  const comment = await prisma.newsEventComment.findUnique({
    where: { id: commentId },
  });

  if (!comment) {
    throw new NotFoundError("Comment not found");
  }

  // Check ownership
  let isOwner = false;
  if (req.student && comment.studentId === req.student.id) {
    isOwner = true;
  } else if (req.teacher && comment.teacherId === req.teacher.id) {
    isOwner = true;
  }

  if (!isOwner) {
    res.status(403);
    throw new Error("Not authorized to delete this comment");
  }

  // Delete the comment
  await prisma.newsEventComment.delete({
    where: { id: commentId },
  });

  res.status(200).json({
    success: true,
    message: "Comment deleted successfully",
    data: null,
  });
}); 