import { api } from './api';
import {
  Conversation,
  Message,
  ApiResponse,
  ConversationCreateData
} from '../common/types';

// Note: Conversations feature is temporarily disabled
// These endpoints exist but are not currently used in the UI
export const conversationService = {
  // Admin routes
  getMyConversations: (): Promise<ApiResponse<Conversation[]>> =>
    api.get('/conversations/admin'),

  getConversation: (id: string): Promise<ApiResponse<Conversation>> =>
    api.get(`/conversations/admin/${id}`),

  createConversation: (data: ConversationCreateData): Promise<ApiResponse<Conversation>> =>
    api.post('/conversations/admin', data),

  sendMessage: (conversationId: string, data: { content: string }): Promise<ApiResponse<Message>> =>
    api.post(`/conversations/admin/${conversationId}/messages`, data),

  leaveConversation: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.put(`/conversations/admin/${id}/leave`),

  // Teacher routes
  getMyTeacherConversations: (): Promise<ApiResponse<Conversation[]>> =>
    api.get('/conversations/teacher'),

  getTeacherConversation: (id: string): Promise<ApiResponse<Conversation>> =>
    api.get(`/conversations/teacher/${id}`),

  createTeacherConversation: (data: ConversationCreateData): Promise<ApiResponse<Conversation>> =>
    api.post('/conversations/teacher', data),

  sendTeacherMessage: (conversationId: string, data: { content: string }): Promise<ApiResponse<Message>> =>
    api.post(`/conversations/teacher/${conversationId}/messages`, data),

  leaveTeacherConversation: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.put(`/conversations/teacher/${id}/leave`),

  // Student routes
  getMyStudentConversations: (): Promise<ApiResponse<Conversation[]>> =>
    api.get('/conversations/student'),

  getStudentConversation: (id: string): Promise<ApiResponse<Conversation>> =>
    api.get(`/conversations/student/${id}`),

  createStudentConversation: (data: ConversationCreateData): Promise<ApiResponse<Conversation>> =>
    api.post('/conversations/student', data),

  sendStudentMessage: (conversationId: string, data: { content: string }): Promise<ApiResponse<Message>> =>
    api.post(`/conversations/student/${conversationId}/messages`, data),

  leaveStudentConversation: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.put(`/conversations/student/${id}/leave`),
};
