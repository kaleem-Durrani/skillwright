import express from "express";
import {
  getAllPublishedNewsEvents,
  getPublishedNewsEvent,
  getNewsEventComments,
  createNewsEventComment,
  updateNewsEventComment,
  deleteNewsEventComment,
} from "../controllers/news.controller.js";
import { studentProtect } from "../middleware/authMiddleware.js";
import { teacherProtect } from "../middleware/authMiddleware.js";

/**
 * News & Events Routes (Public)
 * 
 * This file contains all routes related to public news and events functionality:
 * - View all published news/events
 * - View a specific published news/event
 * - View comments for a news/event
 * - Add/update/delete comments (requires authentication)
 */

const router = express.Router();

// Public routes
router.get("/", getAllPublishedNewsEvents);
router.get("/:id", getPublishedNewsEvent);
router.get("/:id/comments", getNewsEventComments);

// Student comment routes
router.post("/:id/comments", studentProtect, createNewsEventComment);
router.put("/comments/:commentId", studentProtect, updateNewsEventComment);
router.delete("/comments/:commentId", studentProtect, deleteNewsEventComment);

// Teacher comment routes (using the same controller functions)
router.post("/:id/comments/teacher", teacherProtect, createNewsEventComment);
router.put("/comments/:commentId/teacher", teacherProtect, updateNewsEventComment);
router.delete("/comments/:commentId/teacher", teacherProtect, deleteNewsEventComment);

export default router; 