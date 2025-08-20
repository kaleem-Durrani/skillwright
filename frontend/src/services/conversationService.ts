import { api } from './api';
import { ApiResponse } from '../common/types';

// Simplified conversation types
export interface ConversationParticipant {
  id: string;
  name: string;
  email: string;
}

export interface ConversationListItem {
  id: string;
  participant: ConversationParticipant;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    isFromTeacher: boolean;
    teacherReadAt: string | null;
    studentReadAt: string | null;
  } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface ConversationMessage {
  id: string;
  content: string;
  isFromTeacher: boolean;
  createdAt: string;
  teacherReadAt: string | null;
  studentReadAt: string | null;
}

export interface ConversationMessagesResponse {
  messages: ConversationMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateConversationRequest {
  participantId: string;
}

export interface CreateConversationResponse {
  id: string;
  participant: ConversationParticipant;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  id: string;
  content: string;
  isFromTeacher: boolean;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  department: {
    id: string;
    name: string;
  };
  // Teacher-specific fields
  qualification?: string;
  specialization?: string;
  // Student-specific fields
  enrollmentNo?: string;
}

/**
 * Simplified Conversation Service
 * Teacher-Student messaging system
 */
export const conversationService = {
  // Teacher endpoints
  teacher: {
    getConversations: (page?: number, limit?: number) =>
      api.get<ApiResponse<ConversationListResponse>>('/conversations/teacher', {
        params: { page, limit }
      }),

    getContacts: () =>
      api.get<ApiResponse<Contact[]>>('/conversations/teacher/contacts'),

    getMessages: (conversationId: string, cursor?: string, limit?: number) =>
      api.get<ApiResponse<ConversationMessagesResponse>>(`/conversations/teacher/${conversationId}/messages`, {
        params: { cursor, limit }
      }),

    createConversation: (data: CreateConversationRequest) =>
      api.post<ApiResponse<CreateConversationResponse>>('/conversations/teacher/create', data),

    sendMessage: (conversationId: string, data: SendMessageRequest) =>
      api.post<ApiResponse<SendMessageResponse>>(`/conversations/teacher/${conversationId}/messages`, data),

    markAsRead: (conversationId: string) =>
      api.put<ApiResponse<{ markedAsRead: number }>>(`/conversations/teacher/${conversationId}/read`),
  },

  // Student endpoints
  student: {
    getConversations: (page?: number, limit?: number) =>
      api.get<ApiResponse<ConversationListResponse>>('/conversations/student', {
        params: { page, limit }
      }),

    getContacts: () =>
      api.get<ApiResponse<Contact[]>>('/conversations/student/contacts'),

    getMessages: (conversationId: string, cursor?: string, limit?: number) =>
      api.get<ApiResponse<ConversationMessagesResponse>>(`/conversations/student/${conversationId}/messages`, {
        params: { cursor, limit }
      }),

    createConversation: (data: CreateConversationRequest) =>
      api.post<ApiResponse<CreateConversationResponse>>('/conversations/student/create', data),

    sendMessage: (conversationId: string, data: SendMessageRequest) =>
      api.post<ApiResponse<SendMessageResponse>>(`/conversations/student/${conversationId}/messages`, data),

    markAsRead: (conversationId: string) =>
      api.put<ApiResponse<{ markedAsRead: number }>>(`/conversations/student/${conversationId}/read`),
  },
};
