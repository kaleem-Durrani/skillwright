import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { webSocketService } from '../services/webSocketService';
import { useAuth } from '../context/AuthContext';

interface UseWebSocketOptions {
  onNewMessage?: (message: any) => void;
  onUserTyping?: (data: { userId: string; userType: string; isTyping: boolean }) => void;
  onMessagesRead?: (data: { userId: string; userType: string; conversationId: string; messageIds: string[]; readAt: string }) => void;
  onNewConversation?: (conversation: any) => void;
  onError?: (error: string) => void;
}

/**
 * Custom hook for WebSocket connection and real-time messaging
 */
export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiryRef = useRef<number | null>(null);
  const { isAuthenticated } = useAuth();

  // Get or refresh WebSocket token
  const getValidToken = async (): Promise<string> => {
    const now = Date.now();

    // Check if we have a valid token that hasn't expired (with 5 min buffer)
    if (tokenRef.current && tokenExpiryRef.current && (tokenExpiryRef.current - now) > 5 * 60 * 1000) {
      return tokenRef.current;
    }

    // Get new token
    const token = await webSocketService.getWebSocketToken();
    tokenRef.current = token;
    // Set expiry to 55 minutes from now (5 min buffer before actual 1h expiry)
    tokenExpiryRef.current = now + 55 * 60 * 1000;

    return token;
  };

  const connect = async () => {
    if (socketRef.current?.connected) return;

    if (!isAuthenticated) {
      console.error('User not authenticated for WebSocket connection');
      return;
    }

    setIsConnecting(true);

    try {
      // Get WebSocket token from backend
      const token = await getValidToken();

      // Create socket connection
      const socket = io(import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:5000', {
        auth: { token },
        transports: ['websocket', 'polling'],
      });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setIsConnecting(false);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setIsConnecting(false);
    });

    socket.on('connect_error', async (error) => {
      console.error('WebSocket connection error:', error);
      setIsConnected(false);
      setIsConnecting(false);

      // If error is due to authentication, try to refresh token and reconnect
      if (error.message.includes('Authentication') || error.message.includes('Invalid')) {
        console.log('Authentication error, attempting to refresh token and reconnect...');
        try {
          // Clear old token
          tokenRef.current = null;
          tokenExpiryRef.current = null;

          // Wait a bit before retrying
          setTimeout(() => {
            if (isAuthenticated) {
              connect();
            }
          }, 2000);
        } catch (refreshError) {
          console.error('Failed to refresh token for WebSocket:', refreshError);
          options.onError?.('Failed to refresh WebSocket connection');
        }
      } else {
        options.onError?.(error.message);
      }
    });

    // Message events
    socket.on('new_message', (message) => {
      console.log('WebSocket: New message received:', message);
      options.onNewMessage?.(message);
    });

    socket.on('user_typing', (data) => {
      options.onUserTyping?.(data);
    });

    socket.on('messages_read', (data) => {
      options.onMessagesRead?.(data);
    });

    socket.on('new_conversation', (conversation) => {
      options.onNewConversation?.(conversation);
    });

    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      options.onError?.(error.message);
    });

    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      setIsConnecting(false);
      options.onError?.('Failed to connect to WebSocket');
    }
  };

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsConnecting(false);
    }
    // Clear token cache
    tokenRef.current = null;
    tokenExpiryRef.current = null;
  };

  const refreshConnection = async () => {
    if (!isAuthenticated) return;

    console.log('Refreshing WebSocket connection...');
    disconnect();
    await connect();
  };

  const joinConversation = (conversationId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join_conversation', conversationId);
    }
  };

  const leaveConversation = (conversationId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave_conversation', conversationId);
    }
  };

  const startTyping = (conversationId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('typing_start', conversationId);
    }
  };

  const stopTyping = (conversationId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('typing_stop', conversationId);
    }
  };

  const markMessagesAsRead = (conversationId: string, messageIds: string[]) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('message_read', { conversationId, messageIds });
    }
  };

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!isConnected || !tokenExpiryRef.current) return;

    const timeUntilExpiry = tokenExpiryRef.current - Date.now();
    const refreshTime = Math.max(timeUntilExpiry - 5 * 60 * 1000, 60 * 1000); // Refresh 5 min before expiry, but at least 1 min from now

    const refreshTimer = setTimeout(() => {
      if (isConnected && isAuthenticated) {
        console.log('Auto-refreshing WebSocket token...');
        refreshConnection();
      }
    }, refreshTime);

    return () => clearTimeout(refreshTimer);
  }, [isConnected, isAuthenticated]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    refreshConnection,
    joinConversation,
    leaveConversation,
    startTyping,
    stopTyping,
    markMessagesAsRead,
  };
};

/**
 * Hook for managing WebSocket connection globally
 * Use this in your main App component or auth context
 */
export const useWebSocketConnection = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const { isAuthenticated } = useAuth();

  const initializeWebSocket = async () => {
    if (!isAuthenticated || socket?.connected) return;

    try {
      // Get WebSocket token from backend
      const token = await webSocketService.getWebSocketToken();

      const newSocket = io(import.meta.env.VITE_API_BASE_URL?.replace('/api', '') || 'http://localhost:5000', {
        auth: { token },
        transports: ['websocket', 'polling'],
      });

      newSocket.on('connect', () => {
        console.log('Global WebSocket connected');
        setSocket(newSocket);
      });

      newSocket.on('disconnect', () => {
        console.log('Global WebSocket disconnected');
        setSocket(null);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Global WebSocket connection error:', error);
        setSocket(null);
      });

      return newSocket;
    } catch (error) {
      console.error('Failed to initialize global WebSocket:', error);
      return null;
    }
  };

  const closeWebSocket = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  useEffect(() => {
    return () => {
      closeWebSocket();
    };
  }, []);

  return {
    socket,
    initializeWebSocket,
    closeWebSocket,
    isConnected: socket?.connected || false,
  };
};
