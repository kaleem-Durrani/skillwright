import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import { ValidationError, AuthenticationError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import {
  generateAccessToken,
  generateRefreshToken,
  setTokens,
  clearTokens
} from "../utils/tokenUtils.js";
import { withTransaction } from "../utils/transactionUtils.js";

// @desc    Login admin
// @route   POST /api/auth/admin/login
// @access  Public
export const loginAdmin = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password } = req.body;

  // Use transaction utility for the entire process
  const result = await withTransaction(async (tx) => {
    // Find admin by email
    const admin = await tx.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new AuthenticationError("Invalid credentials");
    }

    // Check if admin is active
    if (!admin.isActive) {
      throw new AuthenticationError("Your account has been deactivated");
    }

    // Check password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      throw new AuthenticationError("Invalid credentials");
    }

    // Generate tokens
    const accessToken = generateAccessToken(admin.id, 'admin');
    const refreshToken = generateRefreshToken();

    // Store refresh token in database
    await tx.refreshToken.create({
      data: {
        token: refreshToken,
        adminId: admin.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      admin,
      accessToken,
      refreshToken
    };
  });

  // Set tokens in cookies (this has to be outside the transaction as it modifies the response)
  setTokens(res, result.accessToken, result.refreshToken);

  // Extract admin from result
  const admin = result.admin;

  res.status(200).json({
    success: true,
    message: "Login successful",
    data: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      userType: 'admin'
    },
  });
});

// @desc    Logout admin
// @route   POST /api/auth/admin/logout
// @access  Private
export const logoutAdmin = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;

  // Use transaction utility
  await withTransaction(async (tx) => {
    // Delete refresh token from database if it exists
    if (refreshToken && req.admin?.id) {
      await tx.refreshToken.deleteMany({
        where: { adminId: req.admin.id }
      });
    }
  });

  // Clear cookies (outside transaction as it modifies the response)
  clearTokens(res);

  res.status(200).json({
    success: true,
    message: "Logout successful",
    data: null,
  });
});

// @desc    Signup admin (restricted)
// @route   POST /api/auth/admin/signup
// @access  Private (Only existing admins can create new admins)
export const signupAdmin = asyncHandler(async (req: Request, res: Response) => {
  // This is a restricted route, only for development or super admin use
  // In a real application, you might want to add additional checks here

  const { name, email, password, designation } = req.body;

  // Use transaction utility
  const admin = await withTransaction(async (tx) => {
    // Check if admin already exists
    const adminExists = await tx.admin.findUnique({
      where: { email },
    });

    if (adminExists) {
      throw new AuthenticationError("Admin already exists");
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create admin
    return await tx.admin.create({
      data: {
        name,
        email,
        password: hashedPassword,
        designation,
        isActive: true,
        isVerified: true,
      },
    });
  });

  res.status(201).json({
    success: true,
    message: "Admin created successfully",
    data: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
    },
  });
});
