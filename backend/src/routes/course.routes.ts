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
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";

const router = express.Router();

// Public routes
router.get("/", getAllCourses);
router.get("/:id", getCourse);

// Protected routes (Teacher only)
router.post("/", protectTeacherRoute, createCourseValidation, createCourse);
router.put("/:id", protectTeacherRoute, updateCourseValidation, updateCourse);
router.delete("/:id", protectTeacherRoute, deleteCourse);
router.get("/:id/resources", protectTeacherRoute, getCourseResources);
router.get("/:id/students", protectTeacherRoute, getEnrolledStudents);
router.put("/:id/enrollments/:enrollmentId", protectTeacherRoute, updateEnrollmentStatus);

export default router; 