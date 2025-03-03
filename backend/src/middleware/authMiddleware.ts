import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import { AuthenticationError, ForbiddenError } from '../utils/customErrors.js';
import prisma from '../db/prisma.js';

// Extend Request type to include user properties
declare global {
  namespace Express {
    interface Request {
      admin?: any;
      teacher?: any;
      student?: any;
      userId?: string;
      userType?: 'admin' | 'teacher' | 'student';
    }
  }
}

// Verify JWT token from cookies
const verifyToken = (req: Request) => {
  const token = req.cookies.accessToken;
  
  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET as string) as {
      userId: string;
      userType: 'admin' | 'teacher' | 'student';
    };
  } catch (error) {
    return null;
  }
};

// Protect routes - general authentication
export const protect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const decoded = verifyToken(req);
  
  if (!decoded) {
    throw new AuthenticationError('Not authorized, token failed');
  }

  req.userId = decoded.userId;
  req.userType = decoded.userType;

  next();
});

// Admin middleware
export const adminProtect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const decoded = verifyToken(req);
  
  if (!decoded) {
    throw new AuthenticationError('Not authorized, token failed');
  }

  if (decoded.userType !== 'admin') {
    throw new ForbiddenError('Not authorized as admin');
  }

  const admin = await prisma.admin.findUnique({
    where: { id: decoded.userId },
  });

  if (!admin) {
    throw new AuthenticationError('Admin not found');
  }

  req.admin = admin;
  req.userId = decoded.userId;
  req.userType = decoded.userType;

  next();
});

// Teacher middleware
export const teacherProtect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const decoded = verifyToken(req);
  
  if (!decoded) {
    throw new AuthenticationError('Not authorized, token failed');
  }

  if (decoded.userType !== 'teacher') {
    throw new ForbiddenError('Not authorized as teacher');
  }

  const teacher = await prisma.teacher.findUnique({
    where: { id: decoded.userId },
  });

  if (!teacher) {
    throw new AuthenticationError('Teacher not found');
  }

  if (teacher.isBanned) {
    throw new ForbiddenError('Your account has been banned');
  }

  req.teacher = teacher;
  req.userId = decoded.userId;
  req.userType = decoded.userType;

  next();
});

// Student middleware
export const studentProtect = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const decoded = verifyToken(req);
  
  if (!decoded) {
    throw new AuthenticationError('Not authorized, token failed');
  }

  if (decoded.userType !== 'student') {
    throw new ForbiddenError('Not authorized as student');
  }

  const student = await prisma.student.findUnique({
    where: { id: decoded.userId },
  });

  if (!student) {
    throw new AuthenticationError('Student not found');
  }

  if (student.isBanned) {
    throw new ForbiddenError('Your account has been banned');
  }

  req.student = student;
  req.userId = decoded.userId;
  req.userType = decoded.userType;

  next();
}); 