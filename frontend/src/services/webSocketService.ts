import { api } from './api';

interface WebSocketTokenResponse {
  token: string;
  expiresIn: string;
}

/**
 * WebSocket Service
 * Handles WebSocket token management for real-time connections
 */
export const webSocketService = {
  /**
   * Get a WebSocket token for authentication
   * This token is specifically for WebSocket connections and is separate from HTTP-only cookies
   */
  getWebSocketToken: async (): Promise<string> => {
    try {
      const response = await api.get<WebSocketTokenResponse>('/auth/refresh/websocket-token');
      
      if (response.success && response.data) {
        return response.data.token;
      } else {
        throw new Error('Failed to get WebSocket token');
      }
    } catch (error) {
      console.error('Error getting WebSocket token:', error);
      throw error;
    }
  },
};
