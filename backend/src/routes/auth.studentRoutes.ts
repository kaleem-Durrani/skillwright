import express from "express";
import {
  loginStudent,
  logoutStudent,
  signupStudent,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.studentController.js";
import {
  signupValidation,
  loginValidation,
  otpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} from "../routesValidation/auth.studentRoutes.validation.js";
import { protectStudentRoute } from "../middleware/protectStudentRoute.js";

/**
 * Student Authentication Routes
 * 
 * This file contains all routes related to student authentication:
 * - Student signup
 * - Student login/logout
 * - OTP verification
 * - Password management (forgot/reset)
 * 
 * Logout route is protected with student authentication middleware
 */

const router = express.Router();

// Public routes
router.post("/signup", signupValidation, signupStudent);
router.post("/login", loginValidation, loginStudent);
router.post("/verify-otp", otpValidation, verifyOtp);
router.post("/resend-otp", forgotPasswordValidation, resendOtp); // reusing forgotPassword validation as it only needs email
router.post("/forgot-password", forgotPasswordValidation, forgotPassword);
router.post("/reset-password", resetPasswordValidation, resetPassword);

// Protected routes
router.post("/logout", protectStudentRoute, logoutStudent);

export default router;
