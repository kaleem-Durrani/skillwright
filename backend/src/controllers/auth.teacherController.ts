import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { generateToken } from "../utils/generateToken.js";
import { sendEmail } from "../utils/sendEmail.js";
import { generateOTP } from "../utils/generateOTP.js";
import { ValidationError, NotFoundError, ForbiddenError, AuthenticationError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";

// @desc    Register a new teacher
// @route   POST /api/auth/teacher/signup
// @access  Public
const signupTeacher = asyncHandler(async (req: Request, res: Response) => {
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

  // Generate token
  generateToken(res, teacher.id);

  res.status(201).json({
    success: true,
    data: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      isVerified: teacher.isVerified,
    },
  });
});

// @desc    Login teacher
// @route   POST /api/auth/teacher/login
// @access  Public
const loginTeacher = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password } = req.body;

  const teacher = await prisma.teacher.findUnique({
    where: { email },
  });

  if (!teacher) {
    throw new AuthenticationError("Invalid email or password");
  }

  if (teacher.isBanned) {
    throw new ForbiddenError("Your account has been banned. Please contact the administrators.");
  }

  const isPasswordMatch = await bcrypt.compare(password, teacher.password);
  if (!isPasswordMatch) {
    throw new AuthenticationError("Invalid email or password");
  }

  generateToken(res, teacher.id);

  res.status(200).json({
    success: true,
    data: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      isVerified: teacher.isVerified,
    },
  });
});

// @desc    Logout teacher
// @route   POST /api/auth/teacher/logout
// @access  Private
const logoutTeacher = asyncHandler(async (req: Request, res: Response) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// @desc    Verify OTP
// @route   POST /api/auth/teacher/verify-otp
// @access  Public
const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
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
const resendOtp = asyncHandler(async (req: Request, res: Response) => {
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

    if (teacher.otpExpiry && new Date() < teacher.otpExpiry) {
      throw new ValidationError({
        email: ["Please wait for the previous OTP to expire"],
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
const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
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

    if (teacher.otpExpiry && new Date() < teacher.otpExpiry) {
      throw new ValidationError({
        email: ["Please wait for the previous OTP to expire"],
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

  await sendEmail(
    email,
    "Reset Password - Millat Vocational Training",
    `Your password reset code is: ${otp}\nThis code will expire in 15 minutes.`
  );

  res.status(200).json({
    success: true,
    message: "Password reset OTP sent successfully",
  });
});

// @desc    Reset password
// @route   POST /api/auth/teacher/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, otp, newPassword } = req.body;

  // Start transaction
  await prisma.$transaction(async (tx) => {
    const teacher = await tx.teacher.findUnique({
      where: { email },
    });

    if (!teacher) {
      throw new NotFoundError("Teacher not found");
    }

    if (!teacher.otp || !teacher.otpExpiry) {
      throw new ValidationError({
        otp: ["No OTP found. Please request a password reset"],
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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

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
  });
});

export {
  signupTeacher,
  loginTeacher,
  logoutTeacher,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
};
