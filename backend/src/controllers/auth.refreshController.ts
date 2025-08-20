import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler.js';
import { AuthenticationError } from '../utils/customErrors.js';
import prisma from '../db/prisma.js';
import {
  verifyRefreshToken,
  generateAccessToken,
  generateRefreshToken,
  generateWebSocketToken,
  storeRefreshToken,
  deleteRefreshToken,
  setTokens
} from '../utils/tokenUtils.js';

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public (with refresh token)
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refreshToken;
  
  if (!refreshToken) {
    throw new AuthenticationError('No refresh token provided');
  }
  
  // Verify the refresh token
  const tokenData = await verifyRefreshToken(refreshToken);
  
  if (!tokenData) {
    throw new AuthenticationError('Invalid refresh token');
  }

  const { userId, userType } = tokenData;

  // Delete the old refresh token
  await deleteRefreshToken(refreshToken);

  // Generate new tokens
  const newAccessToken = generateAccessToken(userId, userType);
  const newRefreshToken = generateRefreshToken();

  // Store the new refresh token
  await storeRefreshToken(newRefreshToken, userId, userType);

  // Get user data based on userType
  let userData;
  if (userType === 'admin') {
    userData = await prisma.admin.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true
      }
    });
  } else if (userType === 'teacher') {
    userData = await prisma.teacher.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isVerified: true,
        department: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
  } else if (userType === 'student') {
    userData = await prisma.student.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isVerified: true,
        department: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });
  }

  if (!userData) {
    throw new AuthenticationError('User not found');
  }

  // Set the new tokens in cookies
  setTokens(res, newAccessToken, newRefreshToken);

  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    data: {
      ...userData,
      userType
    }
  });
});

// @desc    Get WebSocket token for real-time connections
// @route   GET /api/auth/refresh/websocket-token
// @access  Private (requires valid access token)
export const getWebSocketToken = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId;
  const userType = req.userType;

  if (!userId || !userType) {
    throw new AuthenticationError('User not authenticated');
  }

  // Generate WebSocket token
  const wsToken = generateWebSocketToken(userId, userType);

  res.status(200).json({
    success: true,
    message: 'WebSocket token generated successfully',
    data: {
      token: wsToken,
      expiresIn: '1h'
    }
  });
});