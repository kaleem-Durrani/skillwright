import jwt from 'jsonwebtoken';
import { Response } from 'express';
import crypto from 'crypto';
import prisma from '../db/prisma.js';

type UserType = 'admin' | 'teacher' | 'student';

// Generate JWT access token
export const generateAccessToken = (userId: string, userType: UserType): string => {
  return jwt.sign(
    { userId, userType },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '15m' }
  );
};

// Generate a random refresh token
export const generateRefreshToken = (): string => {
  return crypto.randomBytes(40).toString('hex');
};

// Store refresh token in database
export const storeRefreshToken = async (
  token: string,
  userId: string,
  userType: UserType
): Promise<void> => {
  const data: any = {
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  };

  // Set the appropriate user ID field based on user type
  if (userType === 'admin') {
    data.adminId = userId;
  } else if (userType === 'teacher') {
    data.teacherId = userId;
  } else if (userType === 'student') {
    data.studentId = userId;
  }

  await prisma.refreshToken.create({ data });
};

// Delete a specific refresh token
export const deleteRefreshToken = async (token: string): Promise<void> => {
  // Use deleteMany instead of delete to avoid errors when token doesn't exist
  await prisma.refreshToken.deleteMany({
    where: { token },
  });
};

// Delete all refresh tokens for a user
export const deleteAllRefreshTokens = async (
  userId: string,
  userType: UserType
): Promise<void> => {
  const where: any = {};

  if (userType === 'admin') {
    where.adminId = userId;
  } else if (userType === 'teacher') {
    where.teacherId = userId;
  } else if (userType === 'student') {
    where.studentId = userId;
  }

  await prisma.refreshToken.deleteMany({ where });
};

// Verify refresh token and return user data
export const verifyRefreshToken = async (token: string) => {
  const refreshToken = await prisma.refreshToken.findUnique({
    where: { token },
  });

  if (!refreshToken) {
    return null;
  }

  // Check if token is expired
  if (new Date() > refreshToken.expiresAt) {
    await deleteRefreshToken(token);
    return null;
  }

  // Determine user type and ID
  let userId: string;
  let userType: UserType;

  if (refreshToken.adminId) {
    userId = refreshToken.adminId;
    userType = 'admin';
  } else if (refreshToken.teacherId) {
    userId = refreshToken.teacherId;
    userType = 'teacher';
  } else if (refreshToken.studentId) {
    userId = refreshToken.studentId;
    userType = 'student';
  } else {
    // This shouldn't happen, but just in case
    await deleteRefreshToken(token);
    return null;
  }

  return { userId, userType };
};

// Set tokens in cookies
export const setTokens = (
  res: Response,
  accessToken: string,
  refreshToken: string
): void => {
  // Set access token in cookie
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  // Set refresh token in cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// Clear tokens from cookies
export const clearTokens = (res: Response): void => {
  res.cookie('accessToken', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
  });

  res.cookie('refreshToken', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
  });
}; 