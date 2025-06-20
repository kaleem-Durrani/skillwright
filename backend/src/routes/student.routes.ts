import express from "express";
import {
  getDashboardStats,
  getProfile,
  updateProfile,
  getEnrolledCourses,
  getPendingRequests,
  getAvailableCourses,
  getCourseDetails,
  requestEnrollment,
  cancelEnrollmentRequest,
  withdrawFromCourse,
  getCourseResources,
  getAllPublicResources,
  getResourceDetails,
  getResourceComments,
  createResourceComment,
  updateResourceComment,
  deleteResourceComment,
} from "../controllers/student.controller.js";
import {
  updateProfileValidation,
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
router.get("/dashboard", studentProtect, getDashboardStats);
router.get("/profile", studentProtect, getProfile);
router.put("/profile", studentProtect, updateProfileValidation, updateProfile);
router.get("/courses", studentProtect, getEnrolledCourses);
router.get("/courses/pending", studentProtect, getPendingRequests);
router.get("/courses/available", studentProtect, getAvailableCourses);
router.get("/courses/:courseId", studentProtect, getCourseDetails);
router.post("/courses/:courseId/enroll", studentProtect, requestEnrollment);
router.delete("/enrollments/:enrollmentId", studentProtect, cancelEnrollmentRequest);
router.put("/courses/:courseId/withdraw", studentProtect, checkCourseAccess, withdrawFromCourse);

// Protected Routes (Student + Course Access)
router.get("/courses/:courseId/resources", studentProtect, checkCourseAccess, getCourseResources);
router.get("/resources/public", studentProtect, getAllPublicResources);
router.get("/resources/:resourceId", studentProtect, getResourceDetails);
router.get("/resources/:resourceId/comments", studentProtect, getResourceComments);
router.post(
  "/resources/:resourceId/comments",
  studentProtect,
  resourceCommentValidation,
  createResourceComment
);
router.put(
  "/resources/comments/:commentId",
  studentProtect,
  updateCommentValidation,
  updateResourceComment
);
router.delete(
  "/resources/comments/:commentId",
  studentProtect,
  deleteResourceComment
);

// Note: Admin-only routes for student management (getAllStudents, getStudentById, toggleStudentBan, deleteStudent)
// are defined in the admin.routes.ts file to maintain logical organization

export default router;
