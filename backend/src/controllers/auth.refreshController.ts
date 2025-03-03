import { Request, Response } from 'express';
import asyncHandler from '../middleware/asyncHandler.js';
import { AuthenticationError } from '../utils/customErrors.js';
import prisma from '../db/prisma.js';
import { 
  verifyRefreshToken, 
  generateAccessToken, 
  generateRefreshToken,
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

  // Set the new tokens in cookies
  setTokens(res, newAccessToken, newRefreshToken);

  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    data: {
      userType
    }
  });
}); 