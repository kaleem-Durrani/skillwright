import express from "express";
import {
  getMyConversations,
  getConversation,
  createConversation,
  sendMessage,
  leaveConversation,
} from "../controllers/conversation.controller.js";
import {
  createConversationValidation,
  sendMessageValidation,
} from "../routesValidation/conversation.validation.js";
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";
import { protectStudentRoute } from "../middleware/protectStudentRoute.js";

/**
 * Conversation Routes
 * 
 * This file contains all routes related to messaging functionality:
 * - View conversations
 * - Create conversations
 * - Send messages
 * - Leave conversations
 * 
 * All routes are protected with authentication middleware
 */

const router = express.Router();

// Middleware to check if user is authenticated as admin, teacher, or student
const protectAnyUserRoute = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.admin || req.teacher || req.student) {
    return next();
  }
  res.status(401).json({
    success: false,
    message: "Not authorized",
  });
};

// Admin routes
router.get("/admin", protectAdminRoute, getMyConversations);
router.get("/admin/:id", protectAdminRoute, getConversation);
router.post("/admin", protectAdminRoute, createConversationValidation, createConversation);
router.post("/admin/:id/messages", protectAdminRoute, sendMessageValidation, sendMessage);
router.put("/admin/:id/leave", protectAdminRoute, leaveConversation);

// Teacher routes
router.get("/teacher", protectTeacherRoute, getMyConversations);
router.get("/teacher/:id", protectTeacherRoute, getConversation);
router.post("/teacher", protectTeacherRoute, createConversationValidation, createConversation);
router.post("/teacher/:id/messages", protectTeacherRoute, sendMessageValidation, sendMessage);
router.put("/teacher/:id/leave", protectTeacherRoute, leaveConversation);

// Student routes
router.get("/student", protectStudentRoute, getMyConversations);
router.get("/student/:id", protectStudentRoute, getConversation);
router.post("/student", protectStudentRoute, createConversationValidation, createConversation);
router.post("/student/:id/messages", protectStudentRoute, sendMessageValidation, sendMessage);
router.put("/student/:id/leave", protectStudentRoute, leaveConversation);

export default router; 