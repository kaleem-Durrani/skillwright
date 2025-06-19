import { api } from './api';
import { 
  Admin,
  Teacher,
  Student,
  NewsEvent,
  ApiResponse,
  TeacherCreateData,
  NewsEventCreateData,
  NewsEventUpdateData
} from '../common/types';

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface QueryParams {
  page?: number;
  limit?: number;
  search?: string;
  departmentId?: string;
  isBanned?: boolean;
  isPublished?: boolean;
  type?: string;
}

export const adminService = {
  // Profile Management
  getProfile: (): Promise<ApiResponse<Admin>> =>
    api.get('/admin/profile'),

  updateProfile: (data: Partial<Admin>): Promise<ApiResponse<Admin>> =>
    api.put('/admin/profile', data),

  // Teacher Management
  getTeachers: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Teacher>>> =>
    api.get('/admin/teachers', { params }),

  getTeacherById: (id: string): Promise<ApiResponse<Teacher>> =>
    api.get(`/admin/teachers/${id}`),

  createTeacher: (data: TeacherCreateData): Promise<ApiResponse<Teacher>> =>
    api.post('/admin/teachers', data),

  toggleTeacherBan: (id: string): Promise<ApiResponse<Teacher>> =>
    api.put(`/admin/teachers/${id}/ban`),

  deleteTeacher: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/admin/teachers/${id}`),

  // Student Management
  getStudents: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Student>>> =>
    api.get('/admin/students', { params }),

  getStudentById: (id: string): Promise<ApiResponse<Student>> =>
    api.get(`/admin/students/${id}`),

  toggleStudentBan: (id: string): Promise<ApiResponse<Student>> =>
    api.put(`/admin/students/${id}/ban`),

  deleteStudent: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/admin/students/${id}`),

  // News/Events Management
  getNewsEvents: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<NewsEvent>>> =>
    api.get('/admin/news-events', { params }),

  getNewsEventById: (id: string): Promise<ApiResponse<NewsEvent>> =>
    api.get(`/admin/news-events/${id}`),

  createNewsEvent: (data: NewsEventCreateData): Promise<ApiResponse<NewsEvent>> =>
    api.post('/admin/news-events', data),

  updateNewsEvent: (id: string, data: NewsEventUpdateData): Promise<ApiResponse<NewsEvent>> =>
    api.put(`/admin/news-events/${id}`, data),

  deleteNewsEvent: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/admin/news-events/${id}`),

  toggleNewsEventPublish: (id: string): Promise<ApiResponse<NewsEvent>> =>
    api.put(`/admin/news-events/${id}/publish`),

  // Dashboard Statistics (Note: This endpoint doesn't exist in backend yet)
  getDashboardStats: (): Promise<ApiResponse<{
    totalTeachers: number;
    totalStudents: number;
    totalCourses: number;
    totalDepartments: number;
    recentTeachers: Teacher[];
    recentStudents: Student[];
    recentNewsEvents: NewsEvent[];
  }>> =>
    api.get('/admin/dashboard/stats'),
};
