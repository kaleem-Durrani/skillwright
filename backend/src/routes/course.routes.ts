import express from "express";
import {
  createCourse,
  updateCourse,
  deleteCourse,
  getCourse,
  getAllCourses,
  getCourseResources,
  getEnrolledStudents,
  updateEnrollmentStatus,
} from "../controllers/course.controller.js";
import {
  createCourseValidation,
  updateCourseValidation,
} from "../routesValidation/course.validation.js";
import { teacherProtect } from "../middleware/authMiddleware.js";

/**
 * Course Routes
 * 
 * This file contains all routes related to course functionality:
 * - Public course access (view all courses, view specific course)
 * - Teacher course management (CRUD operations)
 * - Enrollment management
 * - Course resources
 * 
 * Public routes are unprotected, while management routes require teacher authentication
 */

const router = express.Router();

// Public routes
router.get("/", getAllCourses);
router.get("/:id", getCourse);

// Protected routes (Teacher only)
router.post("/", teacherProtect, createCourseValidation, createCourse);
router.put("/:id", teacherProtect, updateCourseValidation, updateCourse);
router.delete("/:id", teacherProtect, deleteCourse);
router.get("/:id/resources", teacherProtect, getCourseResources);
router.get("/:id/students", teacherProtect, getEnrolledStudents);
router.put("/:id/enrollments/:enrollmentId", teacherProtect, updateEnrollmentStatus);

export default router; 