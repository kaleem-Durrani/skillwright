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
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";

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
router.get("/profile", protectAdminRoute, getProfile);
router.put("/profile", protectAdminRoute, updateProfileValidation, updateProfile);

// Teacher Management
router.get("/teachers", protectAdminRoute, getAllTeachers);
router.get("/teachers/:id", protectAdminRoute, getTeacherById);
router.put("/teachers/:id/ban", protectAdminRoute, toggleTeacherBan);
router.delete("/teachers/:id", protectAdminRoute, deleteTeacher);

// Student Management
router.get("/students", protectAdminRoute, getAllStudents);
router.get("/students/:id", protectAdminRoute, getStudentById);
router.put("/students/:id/ban", protectAdminRoute, toggleStudentBan);
router.delete("/students/:id", protectAdminRoute, deleteStudent);

// News & Events Management
router.get("/news-events", protectAdminRoute, getAllNewsEvents);
router.get("/news-events/:id", protectAdminRoute, getNewsEvent);
router.post("/news-events", protectAdminRoute, createNewsEventValidation, createNewsEvent);
router.put("/news-events/:id", protectAdminRoute, updateNewsEventValidation, updateNewsEvent);
router.delete("/news-events/:id", protectAdminRoute, deleteNewsEvent);
router.put("/news-events/:id/publish", protectAdminRoute, toggleNewsEventPublish);

export default router;
