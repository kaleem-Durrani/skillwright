import express from "express";
import {
  createResource,
  updateResource,
  deleteResource,
  getResource,
  getResourceComments,
} from "../controllers/resource.controller.js";
import {
  createResourceValidation,
  updateResourceValidation,
} from "../routesValidation/resource.validation.js";
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";
import { checkCourseAccess } from "../middleware/checkCourseAccess.js";

const router = express.Router();

// Protected routes (Teacher only)
router.post("/", protectTeacherRoute, createResourceValidation, createResource);
router.put("/:id", protectTeacherRoute, updateResourceValidation, updateResource);
router.delete("/:id", protectTeacherRoute, deleteResource);

// Protected routes (Course access required)
router.get("/:id", checkCourseAccess, getResource);
router.get("/:id/comments", checkCourseAccess, getResourceComments);

export default router; 