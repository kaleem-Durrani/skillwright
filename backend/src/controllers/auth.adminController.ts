import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import asyncHandler from "../middleware/asyncHandler.js";
import prisma from "../db/prisma.js";
import { generateToken } from "../utils/generateToken.js";
import { ValidationError, AuthenticationError, ForbiddenError } from "../utils/customErrors.js";
import { parseValidationErrors } from "../utils/validationErrorParser.js";

const signupAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json({ message: "Admin signed up successfully" });
});

// @desc    Login admin
// @route   POST /api/auth/admin/login
// @access  Public
const loginAdmin = asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw parseValidationErrors(errors);
  }

  const { email, password } = req.body;

  const admin = await prisma.admin.findUnique({
    where: { email },
  });

  if (!admin) {
    throw new AuthenticationError("Invalid email or password");
  }

  if (!admin.isActive) {
    throw new ForbiddenError("Your account has been deactivated");
  }

  const isPasswordMatch = await bcrypt.compare(password, admin.password);
  if (!isPasswordMatch) {
    throw new AuthenticationError("Invalid email or password");
  }

  generateToken(res, admin.id);

  res.status(200).json({
    success: true,
    data: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      designation: admin.designation,
    },
  });
});

// @desc    Logout admin
// @route   POST /api/auth/admin/logout
// @access  Private
const logoutAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.cookie("token", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

export { signupAdmin, loginAdmin, logoutAdmin };
