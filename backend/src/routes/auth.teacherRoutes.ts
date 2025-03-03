import express from "express";
import {
  loginTeacher,
  logoutTeacher,
  signupTeacher,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.teacherController.js";
import {
  signupValidation,
  loginValidation,
  otpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
} from "../routesValidation/auth.teacherRoutes.validation.js";
import { teacherProtect } from "../middleware/authMiddleware.js";


/**
 * Teacher Authentication Routes
 * 
 * This file contains all routes related to teacher authentication:
 * - Teacher signup
 * - Teacher login/logout
 * - OTP verification
 * - Password management (forgot/reset)
 * 
 * Logout route is protected with teacher authentication middleware
 */

const router = express.Router();

// Public routes
router.post("/signup", signupValidation, signupTeacher);
router.post("/login", loginValidation, loginTeacher);
router.post("/verify-otp", otpValidation, verifyOtp);
router.post("/resend-otp", forgotPasswordValidation, resendOtp); // reusing forgotPassword validation as it only needs email
router.post("/forgot-password", forgotPasswordValidation, forgotPassword);
router.post("/reset-password", resetPasswordValidation, resetPassword);

// Protected routes
router.post("/logout", teacherProtect, logoutTeacher);

export default router;
