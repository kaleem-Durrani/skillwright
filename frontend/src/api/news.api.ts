import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { 
  NewsEvent, 
  NewsEventComment,
  QueryParams, 
  PaginatedResponse,
  NewsEventCreateData,
  NewsEventUpdateData,
} from '../common/types';

export const newsApi = {
  // Public news endpoints
  getAllPublishedNewsEvents: (params?: QueryParams) => 
    api.get<PaginatedResponse<NewsEvent>>(API_ENDPOINTS.NEWS.LIST, { params }),
  
  getPublishedNewsEvent: (id: string) => 
    api.get<NewsEvent>(API_ENDPOINTS.NEWS.BY_ID(id)),
  
  getNewsEventComments: (newsEventId: string) => 
    api.get<NewsEventComment[]>(API_ENDPOINTS.NEWS.COMMENTS(newsEventId)),
  
  // Student comment endpoints
  studentCreateNewsEventComment: (newsEventId: string, content: string) => 
    api.post<NewsEventComment>(API_ENDPOINTS.NEWS.STUDENT_COMMENT(newsEventId), { content }),
  
  studentUpdateNewsEventComment: (commentId: string, content: string) => 
    api.put<NewsEventComment>(API_ENDPOINTS.NEWS.UPDATE_STUDENT_COMMENT(commentId), { content }),
  
  studentDeleteNewsEventComment: (commentId: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.NEWS.DELETE_STUDENT_COMMENT(commentId)),
  
  // Teacher comment endpoints
  teacherCreateNewsEventComment: (newsEventId: string, content: string) => 
    api.post<NewsEventComment>(API_ENDPOINTS.NEWS.TEACHER_COMMENT(newsEventId), { content }),
  
  teacherUpdateNewsEventComment: (commentId: string, content: string) => 
    api.put<NewsEventComment>(API_ENDPOINTS.NEWS.UPDATE_TEACHER_COMMENT(commentId), { content }),
  
  teacherDeleteNewsEventComment: (commentId: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.NEWS.DELETE_TEACHER_COMMENT(commentId)),
  
  // Admin news management endpoints
  adminGetAllNewsEvents: (params?: QueryParams) => 
    api.get<PaginatedResponse<NewsEvent>>(API_ENDPOINTS.ADMIN.NEWS_EVENTS, { params }),
  
  adminGetNewsEvent: (id: string) => 
    api.get<NewsEvent>(API_ENDPOINTS.ADMIN.NEWS_EVENTS_BY_ID(id)),
  
  adminCreateNewsEvent: (data: NewsEventCreateData) => 
    api.post<NewsEvent>(API_ENDPOINTS.ADMIN.NEWS_EVENTS, data),
  
  adminUpdateNewsEvent: (id: string, data: NewsEventUpdateData) => 
    api.put<NewsEvent>(API_ENDPOINTS.ADMIN.NEWS_EVENTS_BY_ID(id), data),
  
  adminDeleteNewsEvent: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.ADMIN.NEWS_EVENTS_BY_ID(id)),
  
  adminToggleNewsEventPublish: (id: string) => 
    api.put<NewsEvent>(API_ENDPOINTS.ADMIN.TOGGLE_NEWS_EVENT_PUBLISH(id)),
}; 