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
  getAllStudents,
  getStudentById,
  toggleStudentBan,
  deleteStudent,
} from "../controllers/student.controller.js";
import {
  updateProfileValidation,
  enrollmentRequestValidation,
  resourceCommentValidation,
  updateCommentValidation,
} from "../routesValidation/student.validation.js";
import { protectStudentRoute } from "../middleware/protectStudentRoute.js";
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";
import { checkCourseAccess } from "../middleware/checkCourseAccess.js";

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

// Protected Routes (Admin Only)
router.get("/", protectAdminRoute, getAllStudents);
router.get("/:id", protectAdminRoute, getStudentById);
router.put("/:id/ban", protectAdminRoute, toggleStudentBan);
router.delete("/:id", protectAdminRoute, deleteStudent);

export default router;
