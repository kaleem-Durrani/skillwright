import { api } from './api';
import {
  Student,
  Course,
  Resource,
  Enrollment,
  ResourceComment,
  ApiResponse,
  QueryParams,
  PaginatedResponse,
  StudentDashboardData
} from '../common/types';

export const studentService = {
  // Dashboard
  getDashboardStats: (): Promise<ApiResponse<StudentDashboardData>> =>
    api.get('/student/dashboard'),

  // Profile Management
  getProfile: (): Promise<ApiResponse<Student>> =>
    api.get('/student/profile'),

  updateProfile: (data: Partial<Student>): Promise<ApiResponse<Student>> =>
    api.put('/student/profile', data),

  // Course Management
  getEnrolledCourses: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Course>>> =>
    api.get('/student/courses', { params }),

  getPendingRequests: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Course>>> =>
    api.get('/student/courses/pending', { params }),

  getAvailableCourses: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Course>>> =>
    api.get('/student/courses/available', { params }),

  getCourseDetails: (courseId: string): Promise<ApiResponse<Course>> =>
    api.get(`/student/courses/${courseId}`),

  requestEnrollment: (courseId: string): Promise<ApiResponse<Enrollment>> =>
    api.post(`/student/courses/${courseId}/enroll`),

  cancelEnrollmentRequest: (enrollmentId: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/student/enrollments/${enrollmentId}`),

  withdrawFromCourse: (courseId: string): Promise<ApiResponse<{ message: string }>> =>
    api.put(`/student/courses/${courseId}/withdraw`),

  // Resource Management
  getCourseResources: (courseId: string, params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Resource>>> =>
    api.get(`/student/courses/${courseId}/resources`, { params }),

  getAllPublicResources: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Resource>>> =>
    api.get('/student/resources/public', { params }),

  getResourceDetails: (resourceId: string): Promise<ApiResponse<Resource>> =>
    api.get(`/student/resources/${resourceId}`),

  // Resource Comments
  getResourceComments: (resourceId: string, params?: QueryParams): Promise<ApiResponse<PaginatedResponse<ResourceComment>>> =>
    api.get(`/student/resources/${resourceId}/comments`, { params }),

  createResourceComment: (resourceId: string, data: { content: string }): Promise<ApiResponse<ResourceComment>> =>
    api.post(`/student/resources/${resourceId}/comments`, data),

  updateResourceComment: (commentId: string, data: { content: string }): Promise<ApiResponse<ResourceComment>> =>
    api.put(`/student/resources/comments/${commentId}`, data),

  deleteResourceComment: (commentId: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/student/resources/comments/${commentId}`),
};
