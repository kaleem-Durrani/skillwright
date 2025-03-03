import express from "express";
import {
  getProfile,
  updateProfile,
  getAllTeachers,
  getTeacherById,
  toggleTeacherBan,
  deleteTeacher,
  getAllStudents,
  getStudentById,
  toggleStudentBan,
  deleteStudent,
  createNewsEvent,
  updateNewsEvent,
  deleteNewsEvent,
  getNewsEvent,
  getAllNewsEvents,
  toggleNewsEventPublish,
} from "../controllers/admin.controller.js";
import {
  updateProfileValidation,
  createNewsEventValidation,
  updateNewsEventValidation,
} from "../routesValidation/admin.validation.js";
import { adminProtect } from "../middleware/authMiddleware.js";


/**
 * Admin Routes
 * 
 * This file contains all routes related to admin functionality:
 * - Admin profile management
 * - Teacher management (view, ban, delete)
 * - Student management (view, ban, delete)
 * - News & Events management (CRUD operations)
 * 
 * All routes are protected with the admin authentication middleware
 */

const router = express.Router();

// Profile Management
router.get("/profile", adminProtect, getProfile);
router.put("/profile", adminProtect, updateProfileValidation, updateProfile);

// Teacher Management
router.get("/teachers", adminProtect, getAllTeachers);
router.get("/teachers/:id", adminProtect, getTeacherById);
router.put("/teachers/:id/ban", adminProtect, toggleTeacherBan);
router.delete("/teachers/:id", adminProtect, deleteTeacher);

// Student Management
router.get("/students", adminProtect, getAllStudents);
router.get("/students/:id", adminProtect, getStudentById);
router.put("/students/:id/ban", adminProtect, toggleStudentBan);
router.delete("/students/:id", adminProtect, deleteStudent);

// News & Events Management
router.get("/news-events", adminProtect, getAllNewsEvents);
router.get("/news-events/:id", adminProtect, getNewsEvent);
router.post("/news-events", adminProtect, createNewsEventValidation, createNewsEvent);
router.put("/news-events/:id", adminProtect, updateNewsEventValidation, updateNewsEvent);
router.delete("/news-events/:id", adminProtect, deleteNewsEvent);
router.put("/news-events/:id/publish", adminProtect, toggleNewsEventPublish);

export default router;
