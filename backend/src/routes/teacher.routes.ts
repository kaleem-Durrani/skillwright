import express from "express";
import {
  getProfile,
  updateProfile,
  getMyCourses,
  getCourseDetails,
  getCourseStudents,
  updateEnrollmentStatus,
  getCourseResources,
  getMyResources,
} from "../controllers/teacher.controller.js";
import {
  updateProfileValidation,
  updateEnrollmentStatusValidation,
} from "../routesValidation/teacher.validation.js";
import { teacherProtect } from "../middleware/authMiddleware.js";

/**
 * Teacher Routes
 * 
 * This file contains all routes related to teacher functionality:
 * - Teacher profile management
 * - Course management (view courses, students, manage enrollments)
 * - Resource management (CRUD operations)
 * - Resource comments
 * 
 * All routes are protected with the teacher authentication middleware
 */

const router = express.Router();

// Profile Management
router.get("/profile", teacherProtect, getProfile);
router.put("/profile", teacherProtect, updateProfileValidation, updateProfile);

// Course Management
router.get("/courses", teacherProtect, getMyCourses);
router.get("/courses/:id", teacherProtect, getCourseDetails);
router.get("/courses/:id/students", teacherProtect, getCourseStudents);
router.put(
  "/courses/:courseId/enrollments/:enrollmentId",
  teacherProtect,
  updateEnrollmentStatusValidation,
  updateEnrollmentStatus
);

// Resource Management
router.get("/courses/:id/resources", teacherProtect, getCourseResources);
router.get("/resources", teacherProtect, getMyResources);

// Note: Nested comment functionality is currently disabled
// Future implementation will support replies to comments

export default router;
