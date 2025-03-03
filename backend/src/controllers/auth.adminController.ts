import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { ValidationError, AuthenticationError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";
import { 
  generateAccessToken, 
  generateRefreshToken, 
  storeRefreshToken, 
  setTokens,
  clearTokens,
  deleteAllRefreshTokens
} from "../utils/tokenUtils.js";

// @desc    Login admin
// @route   POST /api/auth/admin/login
// @access  Public
export const loginAdmin = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password } = req.body;

  // Find admin by email
  const admin = await prisma.admin.findUnique({
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
  await storeRefreshToken(refreshToken, admin.id, 'admin');

  // Set tokens in cookies
  setTokens(res, accessToken, refreshToken);

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
  
  // Delete refresh token from database if it exists
  if (refreshToken && req.admin?.id) {
    try {
      await deleteAllRefreshTokens(req.admin.id, 'admin');
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

// @desc    Signup admin (restricted)
// @route   POST /api/auth/admin/signup
// @access  Private (Only existing admins can create new admins)
export const signupAdmin = asyncHandler(async (req: Request, res: Response) => {
  // This is a restricted route, only for development or super admin use
  // In a real application, you might want to add additional checks here
  
  const { name, email, password, designation } = req.body;

  // Check if admin already exists
  const adminExists = await prisma.admin.findUnique({
    where: { email },
  });

  if (adminExists) {
    throw new AuthenticationError("Admin already exists");
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create admin
  const admin = await prisma.admin.create({
    data: {
      name,
      email,
      password: hashedPassword,
      designation,
      isActive: true,
      isVerified: true,
    },
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
