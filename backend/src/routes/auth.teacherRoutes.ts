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
import { protectTeacherRoute } from "../middleware/protectTeacherRoute.js";

const router = express.Router();

// Public routes
router.post("/signup", signupValidation, signupTeacher);
router.post("/login", loginValidation, loginTeacher);
router.post("/verify-otp", otpValidation, verifyOtp);
router.post("/resend-otp", forgotPasswordValidation, resendOtp); // reusing forgotPassword validation as it only needs email
router.post("/forgot-password", forgotPasswordValidation, forgotPassword);
router.post("/reset-password", resetPasswordValidation, resetPassword);

// Protected routes
router.post("/logout", protectTeacherRoute, logoutTeacher);

export default router;
