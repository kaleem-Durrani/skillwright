import express from "express";
import {
  getMyConversations,
  getConversationMessages,
  createOrGetConversation,
  sendMessage,
  markMessagesAsRead,
  getTeacherContacts,
  getStudentContacts,
} from "../controllers/conversation.controller.js";
import {
  createConversationValidation,
  sendMessageValidation,
} from "../routesValidation/conversation.validation.js";
import { teacherProtect } from "../middleware/authMiddleware.js";
import { studentProtect } from "../middleware/authMiddleware.js";

/**
 * Simplified Conversation Routes
 *
 * Teacher-Student messaging system:
 * - Get conversations list
 * - Get messages for a conversation (with pagination)
 * - Create or get existing conversation
 * - Send messages
 * - Mark messages as read
 */

const router = express.Router();

// Teacher routes
router.get("/teacher", teacherProtect, getMyConversations);
router.get("/teacher/contacts", teacherProtect, getTeacherContacts);
router.get("/teacher/:conversationId/messages", teacherProtect, getConversationMessages);
router.post("/teacher/create", teacherProtect, createConversationValidation, createOrGetConversation);
router.post("/teacher/:conversationId/messages", teacherProtect, sendMessageValidation, sendMessage);
router.put("/teacher/:conversationId/read", teacherProtect, markMessagesAsRead);

// Student routes
router.get("/student", studentProtect, getMyConversations);
router.get("/student/contacts", studentProtect, getStudentContacts);
router.get("/student/:conversationId/messages", studentProtect, getConversationMessages);
router.post("/student/create", studentProtect, createConversationValidation, createOrGetConversation);
router.post("/student/:conversationId/messages", studentProtect, sendMessageValidation, sendMessage);
router.put("/student/:conversationId/read", studentProtect, markMessagesAsRead);

export default router;