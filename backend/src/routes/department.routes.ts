import express from "express";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartment,
  getAllDepartments,
  getDepartmentsForSelect,
} from "../controllers/department.controller.js";
import {
  createDepartmentValidation,
  updateDepartmentValidation,
} from "../routesValidation/department.validation.js";
import { adminProtect } from "../middleware/authMiddleware.js";

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
router.get("/select", getDepartmentsForSelect);
router.get("/:id", getDepartment);

// Protected routes (Admin only)
router.post("/", adminProtect, createDepartmentValidation, createDepartment);
router.put("/:id", adminProtect, updateDepartmentValidation, updateDepartment);
router.delete("/:id", adminProtect, deleteDepartment);

export default router;
