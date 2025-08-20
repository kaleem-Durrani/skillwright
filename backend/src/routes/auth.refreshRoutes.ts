import express from 'express';
import { refreshToken, getWebSocketToken } from '../controllers/auth.refreshController.js';
import { protect } from '../middleware/authMiddleware.js';

/**
 * Auth Refresh Routes
 *
 * This file contains routes for token management:
 * - Refresh access token using refresh token
 * - Get WebSocket token for real-time connections
 */

const router = express.Router();

router.post('/', refreshToken);
router.get('/websocket-token', protect, getWebSocketToken);

export default router;