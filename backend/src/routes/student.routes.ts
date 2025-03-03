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
import { studentProtect } from "../middleware/authMiddleware.js";
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
router.get("/profile", studentProtect, getProfile);
router.put("/profile", studentProtect, updateProfileValidation, updateProfile);
router.get("/courses", studentProtect, getEnrolledCourses);
router.get("/courses/:courseId", studentProtect, checkCourseAccess, getCourseDetails);
router.post("/courses/:courseId/enroll", studentProtect, enrollmentRequestValidation, requestEnrollment);
router.put("/courses/:courseId/withdraw", studentProtect, checkCourseAccess, withdrawFromCourse);

// Protected Routes (Student + Course Access)
router.get("/courses/:courseId/resources", studentProtect, checkCourseAccess, getCourseResources);
router.post(
  "/resources/:resourceId/comments",
  studentProtect,
  checkCourseAccess,
  resourceCommentValidation,
  createResourceComment
);
router.put(
  "/resources/comments/:commentId",
  studentProtect,
  checkCourseAccess,
  updateCommentValidation,
  updateResourceComment
);
router.delete(
  "/resources/comments/:commentId",
  studentProtect,
  checkCourseAccess,
  deleteResourceComment
);

// Note: Admin-only routes for student management (getAllStudents, getStudentById, toggleStudentBan, deleteStudent)
// are defined in the admin.routes.ts file to maintain logical organization

export default router;
