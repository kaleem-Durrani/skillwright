import { api } from './api';
import {
  Student,
  Course,
  Resource,
  Enrollment,
  ResourceComment,
  ApiResponse
} from '../common/types';

export const studentService = {
  // Profile Management
  getProfile: (): Promise<ApiResponse<Student>> =>
    api.get('/student/profile'),

  updateProfile: (data: Partial<Student>): Promise<ApiResponse<Student>> =>
    api.put('/student/profile', data),

  // Course Management
  getEnrolledCourses: (): Promise<ApiResponse<Course[]>> =>
    api.get('/student/courses'),

  getCourseDetails: (courseId: string): Promise<ApiResponse<Course>> =>
    api.get(`/student/courses/${courseId}`),

  requestEnrollment: (courseId: string): Promise<ApiResponse<Enrollment>> =>
    api.post(`/student/courses/${courseId}/enroll`),

  withdrawFromCourse: (courseId: string): Promise<ApiResponse<{ message: string }>> =>
    api.put(`/student/courses/${courseId}/withdraw`),

  // Resource Management
  getCourseResources: (courseId: string): Promise<ApiResponse<Resource[]>> =>
    api.get(`/student/courses/${courseId}/resources`),

  // Resource Comments
  createResourceComment: (resourceId: string, data: { content: string }): Promise<ApiResponse<ResourceComment>> =>
    api.post(`/student/resources/${resourceId}/comments`, data),

  updateResourceComment: (commentId: string, data: { content: string }): Promise<ApiResponse<ResourceComment>> =>
    api.put(`/student/resources/comments/${commentId}`, data),

  deleteResourceComment: (commentId: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/student/resources/comments/${commentId}`),
};
