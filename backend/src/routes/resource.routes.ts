import { Router } from "express";
import {
  createResource,
  updateResource,
  deleteResource,
  getResource,
  getResourceComments,
} from "../controllers/resource.controller.js";
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";
import { protectCourseAccess } from "../middleware/protectCourseAccess.js";
import {
  uploadDocument,
  uploadVideo,
  handleUploadError,
} from "../middleware/uploadMiddleware.js";
import { validateResource } from "../middleware/validateResource.js";

const router = Router();

// Resource routes
router.post(
  "/",
  protectTeacherRoute,
  uploadDocument.single("document"),
  handleUploadError,
  validateResource,
  createResource
);

router.post(
  "/video",
  protectTeacherRoute,
  uploadVideo.single("video"),
  handleUploadError,
  validateResource,
  createResource
);

router.put(
  "/:id",
  protectTeacherRoute,
  validateResource,
  updateResource
);

router.delete(
  "/:id",
  protectTeacherRoute,
  deleteResource
);

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

export default router; 