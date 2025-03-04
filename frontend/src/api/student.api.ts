import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { 
  Student, 
  Course, 
  Resource, 
  ResourceComment,
  QueryParams, 
  PaginatedResponse,
} from '../common/types';

export const studentApi = {
  // Profile
  getProfile: () => 
    api.get<Student>(API_ENDPOINTS.STUDENT.PROFILE),
  
  updateProfile: (data: Partial<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>>) => 
    api.put<Student>(API_ENDPOINTS.STUDENT.PROFILE, data),
  
  // Courses
  getEnrolledCourses: (params?: QueryParams) => 
    api.get<PaginatedResponse<Course>>(API_ENDPOINTS.STUDENT.COURSES, { params }),
  
  getCourseDetails: (id: string) => 
    api.get<Course>(API_ENDPOINTS.STUDENT.COURSE_DETAILS(id)),
  
  requestEnrollment: (courseId: string) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.STUDENT.ENROLL_COURSE(courseId)),
  
  withdrawFromCourse: (courseId: string) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.STUDENT.WITHDRAW_COURSE(courseId)),
  
  // Resources
  getCourseResources: (courseId: string, params?: QueryParams) => 
    api.get<PaginatedResponse<Resource>>(API_ENDPOINTS.STUDENT.COURSE_RESOURCES(courseId), { params }),
  
  // Resource Comments
  getResourceComments: (resourceId: string) => 
    api.get<ResourceComment[]>(API_ENDPOINTS.STUDENT.RESOURCE_COMMENTS(resourceId)),
  
  createResourceComment: (resourceId: string, content: string) => 
    api.post<ResourceComment>(API_ENDPOINTS.STUDENT.RESOURCE_COMMENTS(resourceId), { content }),
  
  updateResourceComment: (commentId: string, content: string) => 
    api.put<ResourceComment>(API_ENDPOINTS.STUDENT.UPDATE_COMMENT(commentId), { content }),
  
  deleteResourceComment: (commentId: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.STUDENT.DELETE_COMMENT(commentId)),
}; 