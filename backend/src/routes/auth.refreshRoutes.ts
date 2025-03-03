import express from 'express';
import { refreshToken } from '../controllers/auth.refreshController.js';

/**
 * Auth Refresh Routes
 * 
 * This file contains the route for refreshing access tokens:
 * - Refresh access token using refresh token
 */

const router = express.Router();

router.post('/', refreshToken);

export default router; 