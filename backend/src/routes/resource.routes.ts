import { Router } from "express";
import {
  createResource,
  updateResource,
  deleteResource,
  getResource,
  getResourceComments,
  getAllPublicResources,
  getResourceById,
} from "../controllers/resource.controller.js";
import { teacherProtect } from "../middleware/authMiddleware.js";
import { protectCourseAccess } from "../middleware/protectCourseAccess.js";
import {
  uploadDocument,
  uploadVideo,
  handleUploadError,
} from "../middleware/uploadMiddleware.js";
import { validateResource } from "../middleware/validateResource.js";

/**
 * Resource Routes
 * 
 * This file contains all routes related to resource functionality:
 * - Public resource access
 * - Teacher resource management (CRUD operations)
 * - Resource comments
 * 
 * Routes are protected with appropriate middleware based on access requirements
 */

const router = Router();

// Public routes
router.get("/public", getAllPublicResources);
router.get("/public/:id", getResourceById);

// Teacher-only resource management routes
router.post(
  "/",
  teacherProtect,
  uploadDocument.single("document"),
  handleUploadError,
  validateResource,
  createResource
);

router.post(
  "/video",
  teacherProtect,
  uploadVideo.single("video"),
  handleUploadError,
  validateResource,
  createResource
);

router.put(
  "/:id",
  teacherProtect,
  uploadDocument.single("document"),
  handleUploadError,
  validateResource,
  updateResource
);

router.delete(
  "/:id",
  teacherProtect,
  deleteResource
);

// Protected routes (requires course access)
router.get(
  "/:id",
  protectCourseAccess,
  getResource
);

router.get(
  "/:id/comments",
  protectCourseAccess,
  getResourceComments
);

// Note: Comment creation/update/delete routes are handled in student and teacher route files
// Note: Nested comment functionality is currently disabled

export default router; 