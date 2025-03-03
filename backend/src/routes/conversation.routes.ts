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
import { adminProtect } from "../middleware/authMiddleware.js";
import { teacherProtect } from "../middleware/authMiddleware.js";
import { studentProtect } from "../middleware/authMiddleware.js";

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
router.get("/admin", adminProtect, getMyConversations);
router.get("/admin/:id", adminProtect, getConversation);
router.post("/admin", adminProtect, createConversationValidation, createConversation);
router.post("/admin/:id/messages", adminProtect, sendMessageValidation, sendMessage);
router.put("/admin/:id/leave", adminProtect, leaveConversation);

// Teacher routes
router.get("/teacher", teacherProtect, getMyConversations);
router.get("/teacher/:id", teacherProtect, getConversation);
router.post("/teacher", teacherProtect, createConversationValidation, createConversation);
router.post("/teacher/:id/messages", teacherProtect, sendMessageValidation, sendMessage);
router.put("/teacher/:id/leave", teacherProtect, leaveConversation);

// Student routes
router.get("/student", studentProtect, getMyConversations);
router.get("/student/:id", studentProtect, getConversation);
router.post("/student", studentProtect, createConversationValidation, createConversation);
router.post("/student/:id/messages", studentProtect, sendMessageValidation, sendMessage);
router.put("/student/:id/leave", studentProtect, leaveConversation);

export default router; 