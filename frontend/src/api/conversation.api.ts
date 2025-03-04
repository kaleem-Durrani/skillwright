import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { 
  Conversation, 
  Message, 
  QueryParams, 
  PaginatedResponse,
  ConversationCreateData,
} from '../common/types';

export const conversationApi = {
  // Admin conversations
  adminGetConversations: (params?: QueryParams) => 
    api.get<PaginatedResponse<Conversation>>(API_ENDPOINTS.CONVERSATIONS.ADMIN.LIST, { params }),
  
  adminGetConversation: (id: string) => 
    api.get<Conversation>(API_ENDPOINTS.CONVERSATIONS.ADMIN.BY_ID(id)),
  
  adminCreateConversation: (data: ConversationCreateData) => 
    api.post<Conversation>(API_ENDPOINTS.CONVERSATIONS.ADMIN.CREATE, data),
  
  adminSendMessage: (conversationId: string, content: string) => 
    api.post<Message>(API_ENDPOINTS.CONVERSATIONS.ADMIN.MESSAGES(conversationId), { content }),
  
  adminLeaveConversation: (conversationId: string) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.CONVERSATIONS.ADMIN.LEAVE(conversationId)),
  
  // Teacher conversations
  teacherGetConversations: (params?: QueryParams) => 
    api.get<PaginatedResponse<Conversation>>(API_ENDPOINTS.CONVERSATIONS.TEACHER.LIST, { params }),
  
  teacherGetConversation: (id: string) => 
    api.get<Conversation>(API_ENDPOINTS.CONVERSATIONS.TEACHER.BY_ID(id)),
  
  teacherCreateConversation: (data: ConversationCreateData) => 
    api.post<Conversation>(API_ENDPOINTS.CONVERSATIONS.TEACHER.CREATE, data),
  
  teacherSendMessage: (conversationId: string, content: string) => 
    api.post<Message>(API_ENDPOINTS.CONVERSATIONS.TEACHER.MESSAGES(conversationId), { content }),
  
  teacherLeaveConversation: (conversationId: string) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.CONVERSATIONS.TEACHER.LEAVE(conversationId)),
  
  // Student conversations
  studentGetConversations: (params?: QueryParams) => 
    api.get<PaginatedResponse<Conversation>>(API_ENDPOINTS.CONVERSATIONS.STUDENT.LIST, { params }),
  
  studentGetConversation: (id: string) => 
    api.get<Conversation>(API_ENDPOINTS.CONVERSATIONS.STUDENT.BY_ID(id)),
  
  studentCreateConversation: (data: ConversationCreateData) => 
    api.post<Conversation>(API_ENDPOINTS.CONVERSATIONS.STUDENT.CREATE, data),
  
  studentSendMessage: (conversationId: string, content: string) => 
    api.post<Message>(API_ENDPOINTS.CONVERSATIONS.STUDENT.MESSAGES(conversationId), { content }),
  
  studentLeaveConversation: (conversationId: string) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.CONVERSATIONS.STUDENT.LEAVE(conversationId)),
}; 