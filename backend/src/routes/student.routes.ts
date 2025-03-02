import express from "express";
import {
  getProfile,
  updateProfile,
  getEnrolledCourses,
  getCourseDetails,
  requestEnrollment,
  withdrawFromCourse,
  getCourseResources,
  createResourceComment,
  updateResourceComment,
  deleteResourceComment,
} from "../controllers/student.controller.js";
import {
  updateProfileValidation,
  enrollmentRequestValidation,
  resourceCommentValidation,
  updateCommentValidation,
} from "../routesValidation/student.validation.js";
import { protectStudentRoute } from "../middleware/protectStudentRoute.js";
import { checkCourseAccess } from "../middleware/checkCourseAccess.js";

/**
 * Student Routes
 * 
 * This file contains all routes related to student functionality:
 * - Profile management
 * - Course enrollment and access
 * - Resource access and comments
 */

const router = express.Router();

// Protected Routes (Student Only)
router.get("/profile", protectStudentRoute, getProfile);
router.put("/profile", protectStudentRoute, updateProfileValidation, updateProfile);
router.get("/courses", protectStudentRoute, getEnrolledCourses);
router.get("/courses/:courseId", protectStudentRoute, checkCourseAccess, getCourseDetails);
router.post("/courses/:courseId/enroll", protectStudentRoute, enrollmentRequestValidation, requestEnrollment);
router.put("/courses/:courseId/withdraw", protectStudentRoute, checkCourseAccess, withdrawFromCourse);

// Protected Routes (Student + Course Access)
router.get("/courses/:courseId/resources", protectStudentRoute, checkCourseAccess, getCourseResources);
router.post(
  "/resources/:resourceId/comments",
  protectStudentRoute,
  checkCourseAccess,
  resourceCommentValidation,
  createResourceComment
);
router.put(
  "/resources/comments/:commentId",
  protectStudentRoute,
  checkCourseAccess,
  updateCommentValidation,
  updateResourceComment
);
router.delete(
  "/resources/comments/:commentId",
  protectStudentRoute,
  checkCourseAccess,
  deleteResourceComment
);

// Note: Admin-only routes for student management (getAllStudents, getStudentById, toggleStudentBan, deleteStudent)
// are defined in the admin.routes.ts file to maintain logical organization

export default router;
