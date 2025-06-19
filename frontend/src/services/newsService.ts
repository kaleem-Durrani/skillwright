import { api } from './api';
import {
  NewsEvent,
  NewsEventComment,
  ApiResponse,
  NewsEventCommentCreateData,
  NewsEventCommentUpdateData,
  QueryParams,
  PaginatedResponse
} from '../common/types';

export const newsService = {
  // Public routes
  getAllPublishedNewsEvents: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<NewsEvent>>> =>
    api.get('/news', { params }),

  getPublishedNewsEvent: (id: string): Promise<ApiResponse<NewsEvent>> =>
    api.get(`/news/${id}`),

  getNewsEventComments: (id: string): Promise<ApiResponse<NewsEventComment[]>> =>
    api.get(`/news/${id}/comments`),

  // Student comment routes
  createNewsEventComment: (newsEventId: string, data: NewsEventCommentCreateData): Promise<ApiResponse<NewsEventComment>> =>
    api.post(`/news/${newsEventId}/comments`, data),

  updateNewsEventComment: (commentId: string, data: NewsEventCommentUpdateData): Promise<ApiResponse<NewsEventComment>> =>
    api.put(`/news/comments/${commentId}`, data),

  deleteNewsEventComment: (commentId: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/news/comments/${commentId}`),

  // Teacher comment routes
  createTeacherNewsEventComment: (newsEventId: string, data: NewsEventCommentCreateData): Promise<ApiResponse<NewsEventComment>> =>
    api.post(`/news/${newsEventId}/comments/teacher`, data),

  updateTeacherNewsEventComment: (commentId: string, data: NewsEventCommentUpdateData): Promise<ApiResponse<NewsEventComment>> =>
    api.put(`/news/comments/${commentId}/teacher`, data),

  deleteTeacherNewsEventComment: (commentId: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/news/comments/${commentId}/teacher`),
};
