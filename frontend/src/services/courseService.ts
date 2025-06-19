import { api } from './api';
import {
  Course,
  Resource,
  Student,
  Enrollment,
  ApiResponse,
  CourseCreateData,
  CourseUpdateData,
  QueryParams,
  PaginatedResponse
} from '../common/types';

export const courseService = {
  // Public routes
  getAllCourses: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Course>>> =>
    api.get('/course', { params }),

  getCourse: (id: string): Promise<ApiResponse<Course>> =>
    api.get(`/course/${id}`),

  // Protected routes (Teacher only)
  createCourse: (data: CourseCreateData): Promise<ApiResponse<Course>> =>
    api.post('/course', data),

  updateCourse: (id: string, data: CourseUpdateData): Promise<ApiResponse<Course>> =>
    api.put(`/course/${id}`, data),

  deleteCourse: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/course/${id}`),

  getCourseResources: (id: string): Promise<ApiResponse<Resource[]>> =>
    api.get(`/course/${id}/resources`),

  getEnrolledStudents: (id: string): Promise<ApiResponse<Student[]>> =>
    api.get(`/course/${id}/students`),

  updateEnrollmentStatus: (courseId: string, enrollmentId: string, status: string): Promise<ApiResponse<Enrollment>> =>
    api.put(`/course/${courseId}/enrollments/${enrollmentId}`, { status }),
};
