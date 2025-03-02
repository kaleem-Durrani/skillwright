import express from "express";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartment,
  getAllDepartments,
} from "../controllers/department.controller.js";
import {
  createDepartmentValidation,
  updateDepartmentValidation,
} from "../routesValidation/department.validation.js";
import { protectAdminRoute } from "../middleware/protectAdminRoute.js";

/**
 * Department Routes
 * 
 * This file contains all routes related to department functionality:
 * - Public department access (view all departments, view specific department)
 * - Admin department management (CRUD operations)
 * 
 * Public routes are unprotected, while management routes require admin authentication
 */

const router = express.Router();

// Public routes
router.get("/", getAllDepartments);
router.get("/:id", getDepartment);

// Protected routes (Admin only)
router.post("/", protectAdminRoute, createDepartmentValidation, createDepartment);
router.put("/:id", protectAdminRoute, updateDepartmentValidation, updateDepartment);
router.delete("/:id", protectAdminRoute, deleteDepartment);

export default router;
