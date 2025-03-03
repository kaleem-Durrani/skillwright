import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { sendEmail } from "../utils/sendEmail.js";
import { generateOTP } from "../utils/generateOTP.js";
import { ValidationError, NotFoundError, ForbiddenError, AuthenticationError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import { 
  generateAccessToken, 
  generateRefreshToken, 
  storeRefreshToken, 
  setTokens,
  clearTokens,
  deleteAllRefreshTokens
} from "../utils/tokenUtils.js";

// @desc    Register a new teacher
// @route   POST /api/auth/teacher/signup
// @access  Public
export const signupTeacher = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password, name, qualification, departmentId, specialization, phoneNumber } = req.body;

  // Generate OTP
  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Start transaction
  const teacher = await prisma.$transaction(async (tx) => {
    // Check if teacher already exists
    const teacherExists = await tx.teacher.findUnique({
      where: { email },
    });

    if (teacherExists) {
      throw new ValidationError({
        email: ["Teacher already exists with this email"],
      });
    }

    // Check if department exists
    const departmentExists = await tx.department.findUnique({
      where: { id: departmentId },
    });

    if (!departmentExists) {
      throw new ValidationError({
        departmentId: ["Department not found"],
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create teacher
    return await tx.teacher.create({
      data: {
        email,
        password: hashedPassword,
        name,
        qualification,
        departmentId,
        specialization,
        phoneNumber,
        otp,
        otpExpiry,
      },
    });
  });

  // Send OTP email
  await sendEmail(
    email,
    "Verify Your Email - Millat Vocational Training",
    `Your verification code is: ${otp}\nThis code will expire in 15 minutes.`
  );

  // Generate tokens
  const accessToken = generateAccessToken(teacher.id, 'teacher');
  const refreshToken = generateRefreshToken();

  // Store refresh token in database
  await storeRefreshToken(refreshToken, teacher.id, 'teacher');

  // Set tokens in cookies
  setTokens(res, accessToken, refreshToken);

  res.status(201).json({
    success: true,
    message: "Teacher registered successfully. Please verify your email.",
    data: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      isVerified: teacher.isVerified,
      userType: 'teacher'
    },
  });
});

// @desc    Login teacher
// @route   POST /api/auth/teacher/login
// @access  Public
export const loginTeacher = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password } = req.body;

  // Find teacher by email
  const teacher = await prisma.teacher.findUnique({
    where: { email },
  });

  if (!teacher) {
    throw new AuthenticationError("Invalid credentials");
  }

  // Check if teacher is banned
  if (teacher.isBanned) {
    throw new AuthenticationError("Your account has been banned");
  }

  // Check password
  const isMatch = await bcrypt.compare(password, teacher.password);
  if (!isMatch) {
    throw new AuthenticationError("Invalid credentials");
  }

  // Generate tokens
  const accessToken = generateAccessToken(teacher.id, 'teacher');
  const refreshToken = generateRefreshToken();

  // Store refresh token in database
  await storeRefreshToken(refreshToken, teacher.id, 'teacher');

  // Set tokens in cookies
  setTokens(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      isVerified: teacher.isVerified,
      userType: 'teacher'
    },
  });
});

// @desc    Logout teacher
// @route   POST /api/auth/teacher/logout
// @access  Private
export const logoutTeacher = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  
  // Delete refresh token from database if it exists
  if (refreshToken && req.teacher?.id) {
    try {
      await deleteAllRefreshTokens(req.teacher.id, 'teacher');
    } catch (error) {
      // Continue even if token deletion fails
      console.error("Error deleting refresh token:", error);
    }
  }
  
  // Clear cookies
  clearTokens(res);

  res.status(200).json({
    success: true,
    message: "Logout successful",
    data: null,
  });
});

// @desc    Verify OTP
// @route   POST /api/auth/teacher/verify-otp
// @access  Public
export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, otp } = req.body;

  // Start transaction
  await prisma.$transaction(async (tx) => {
    const teacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }

    if (teacher.isVerified) {
      throw new ValidationError({
        email: ["Email is already verified"],
      });
    }

    if (!teacher.otp || !teacher.otpExpiry) {
      throw new ValidationError({
        otp: ["No OTP found. Please request a new one"],
      });
    }

    if (teacher.otp !== otp) {
      throw new ValidationError({
        otp: ["Invalid OTP"],
      });
    }

    if (new Date() > teacher.otpExpiry) {
      throw new ValidationError({
        otp: ["OTP has expired"],
      });
    }

    await tx.teacher.update({
      where: { email },
      data: {
        isVerified: true,
        otp: null,
        otpExpiry: null,
      },
    });
  });

  res.status(200).json({
    success: true,
    message: "Email verified successfully",
  });
});

// @desc    Resend OTP
// @route   POST /api/auth/teacher/resend-otp
// @access  Public
export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email } = req.body;
  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 15 * 60 * 1000);

  // Start transaction
  const teacher = await prisma.$transaction(async (tx) => {
    const teacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }

    if (teacher.isVerified) {
      throw new ValidationError({
        email: ["Email is already verified"],
      });
    }

    return await tx.teacher.update({
      where: { email },
      data: {
        otp,
        otpExpiry,
      },
    });
  });

  // Send OTP email
  await sendEmail(
    email,
    "Verify Your Email - Millat Vocational Training",
    `Your verification code is: ${otp}\nThis code will expire in 15 minutes.`
  );

  res.status(200).json({
    success: true,
    message: "OTP sent successfully",
  });
});

// @desc    Forgot password
// @route   POST /api/auth/teacher/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email } = req.body;

  // Generate OTP
  const otp = generateOTP();
  const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await prisma.$transaction(async (tx) => {
    // Check if teacher exists
    const teacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }

    // Update teacher with OTP
    await tx.teacher.update({
      where: { email },
      data: {
        otp: otp,
        otpExpiry: otpExpiry,
      },
    });

    // Send OTP to teacher's email
    await sendEmail(
      email,
      "Password Reset OTP",
      `Your OTP for password reset is ${otp}. It will expire in 15 minutes.`
    );
  });

  res.status(200).json({
    success: true,
    message: "Password reset OTP sent to your email",
    data: null
  });
});

// @desc    Reset password
// @route   POST /api/auth/teacher/reset-password
// @access  Public
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, otp, password } = req.body;

  await prisma.$transaction(async (tx) => {
    // Check if teacher exists
    const teacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }

    if (!teacher.otp || !teacher.otpExpiry) {
      throw new ValidationError({
        otp: ["No OTP found. Please request a new one"],
      });
    }

    if (teacher.otp !== otp) {
      throw new ValidationError({
        otp: ["Invalid OTP"],
      });
    }

    if (new Date() > teacher.otpExpiry) {
      throw new ValidationError({
        otp: ["OTP has expired"],
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await tx.teacher.update({
      where: { email },
      data: {
        password: hashedPassword,
        otp: null,
        otpExpiry: null,
      },
    });
  });

  res.status(200).json({
    success: true,
    message: "Password reset successfully",
    data: null
  });
});
