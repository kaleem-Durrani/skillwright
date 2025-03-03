import express from "express";
import {
  loginAdmin,
  logoutAdmin,
  signupAdmin,
} from "../controllers/auth.adminController.js";
import { loginValidation } from "../routesValidation/auth.adminRoutes.validation.js";
import { adminProtect } from "../middleware/authMiddleware.js";

/**
 * Admin Authentication Routes
 * 
 * This file contains all routes related to admin authentication:
 * - Admin signup (restricted)
 * - Admin login
 * - Admin logout
 * 
 * Logout route is protected with admin authentication middleware
 */

const router = express.Router();

// Public routes
router.post("/signup", signupAdmin);
router.post("/login", loginValidation, loginAdmin);

// Protected routes
router.post("/logout", adminProtect, logoutAdmin);

export default router;
