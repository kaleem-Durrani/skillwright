import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userType?: 'teacher' | 'student';
}

/**
 * WebSocket handler for real-time messaging
 * Handles authentication, room management, and message broadcasting
 */
export const setupWebSocket = (server: HTTPServer) => {
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as any;

      // Verify this is a WebSocket token
      if (decoded.purpose !== 'websocket') {
        return next(new Error('Invalid token type for WebSocket connection'));
      }

      // Verify user exists and is active
      let user = null;
      if (decoded.userType === 'teacher') {
        user = await prisma.teacher.findFirst({
          where: { id: decoded.userId, isBanned: false },
          select: { id: true, name: true }
        });
        socket.userId = decoded.userId;
        socket.userType = 'teacher';
      } else if (decoded.userType === 'student') {
        user = await prisma.student.findFirst({
          where: { id: decoded.userId, isBanned: false },
          select: { id: true, name: true }
        });
        socket.userId = decoded.userId;
        socket.userType = 'student';
      }

      if (!user) {
        return next(new Error('User not found or inactive'));
      }

      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User ${socket.userId} (${socket.userType}) connected`);

    // Join user to their personal room for notifications
    socket.join(`user_${socket.userId}`);

    // Join conversation rooms
    socket.on('join_conversation', async (conversationId: string) => {
      try {
        // Verify user has access to this conversation
        const conversation = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            OR: [
              { teacherId: socket.userId },
              { studentId: socket.userId }
            ]
          }
        });

        if (conversation) {
          socket.join(`conversation_${conversationId}`);
          console.log(`User ${socket.userId} joined conversation ${conversationId}`);
        } else {
          socket.emit('error', { message: 'Access denied to conversation' });
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation_${conversationId}`);
      console.log(`User ${socket.userId} left conversation ${conversationId}`);
    });

    // Handle typing indicators
    socket.on('typing_start', (conversationId: string) => {
      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        userType: socket.userType,
        isTyping: true
      });
    });

    socket.on('typing_stop', (conversationId: string) => {
      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        userType: socket.userType,
        isTyping: false
      });
    });

    // Handle message read receipts
    socket.on('message_read', (data: { conversationId: string, messageIds: string[] }) => {
      socket.to(`conversation_${data.conversationId}`).emit('messages_read', {
        userId: socket.userId,
        userType: socket.userType,
        messageIds: data.messageIds,
        readAt: new Date().toISOString()
      });
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} (${socket.userType}) disconnected`);
    });
  });

  return io;
};

/**
 * Broadcast new message to conversation participants
 */
export const broadcastMessage = (io: SocketIOServer, conversationId: string, message: any) => {
  io.to(`conversation_${conversationId}`).emit('new_message', message);
};

/**
 * Notify user about new conversation
 */
export const notifyNewConversation = (io: SocketIOServer, userId: string, conversation: any) => {
  io.to(`user_${userId}`).emit('new_conversation', conversation);
};
