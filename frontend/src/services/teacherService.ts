import { api } from './api';
import {
  Teacher,
  Course,
  Resource,
  Student,
  Enrollment,
  ApiResponse,
  QueryParams,
  PaginatedResponse
} from '../common/types';

export const teacherService = {
  // Profile Management
  getProfile: (): Promise<ApiResponse<Teacher>> =>
    api.get('/teacher/profile'),

  updateProfile: (data: Partial<Teacher>): Promise<ApiResponse<Teacher>> =>
    api.put('/teacher/profile', data),

  // Course Management
  getMyCourses: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Course>>> =>
    api.get('/teacher/courses', { params }),

  getCourseDetails: (id: string): Promise<ApiResponse<Course>> =>
    api.get(`/teacher/courses/${id}`),

  getCourseStudents: (id: string): Promise<ApiResponse<Student[]>> =>
    api.get(`/teacher/courses/${id}/students`),

  updateEnrollmentStatus: (courseId: string, enrollmentId: string, data: { status: string }): Promise<ApiResponse<Enrollment>> =>
    api.put(`/teacher/courses/${courseId}/enrollments/${enrollmentId}`, data),

  // Resource Management
  getCourseResources: (id: string): Promise<ApiResponse<Resource[]>> =>
    api.get(`/teacher/courses/${id}/resources`),

  getMyResources: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Resource>>> =>
    api.get('/teacher/resources', { params }),
};
