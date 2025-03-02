import express from "express";
import {
  getAllPublishedNewsEvents,
  getPublishedNewsEvent,
  getNewsEventComments,
  createNewsEventComment,
  updateNewsEventComment,
  deleteNewsEventComment,
} from "../controllers/news.controller.js";
import { protectStudentRoute } from "../middleware/protectStudentRoute.js";
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";

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
router.post("/:id/comments", protectStudentRoute, createNewsEventComment);
router.put("/comments/:commentId", protectStudentRoute, updateNewsEventComment);
router.delete("/comments/:commentId", protectStudentRoute, deleteNewsEventComment);

// Teacher comment routes (using the same controller functions)
router.post("/:id/comments/teacher", protectTeacherRoute, createNewsEventComment);
router.put("/comments/:commentId/teacher", protectTeacherRoute, updateNewsEventComment);
router.delete("/comments/:commentId/teacher", protectTeacherRoute, deleteNewsEventComment);

export default router; 