import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { 
  Teacher, 
  Course, 
  Resource, 
  Student, 
  Enrollment,
  ResourceComment,
  QueryParams, 
  PaginatedResponse,
  CourseCreateData,
  CourseUpdateData,
  ResourceCreateData,
  ResourceUpdateData,
} from '../common/types';

export const teacherApi = {
  // Profile
  getProfile: () => 
    api.get<Teacher>(API_ENDPOINTS.TEACHER.PROFILE),
  
  updateProfile: (data: Partial<Omit<Teacher, 'id' | 'createdAt' | 'updatedAt'>>) => 
    api.put<Teacher>(API_ENDPOINTS.TEACHER.PROFILE, data),
  
  // Courses
  getMyCourses: (params?: QueryParams) => 
    api.get<PaginatedResponse<Course>>(API_ENDPOINTS.TEACHER.COURSES, { params }),
  
  getCourseDetails: (id: string) => 
    api.get<Course>(API_ENDPOINTS.TEACHER.COURSE_DETAILS(id)),
  
  createCourse: (data: CourseCreateData) => 
    api.post<Course>(API_ENDPOINTS.TEACHER.COURSES, data),
  
  updateCourse: (id: string, data: CourseUpdateData) => 
    api.put<Course>(API_ENDPOINTS.TEACHER.COURSE_DETAILS(id), data),
  
  deleteCourse: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.TEACHER.COURSE_DETAILS(id)),
  
  // Course Students
  getCourseStudents: (courseId: string, params?: QueryParams) => 
    api.get<PaginatedResponse<Student>>(API_ENDPOINTS.TEACHER.COURSE_STUDENTS(courseId), { params }),
  
  updateEnrollmentStatus: (courseId: string, enrollmentId: string, status: string) => 
    api.put<Enrollment>(API_ENDPOINTS.TEACHER.UPDATE_ENROLLMENT(courseId, enrollmentId), { status }),
  
  // Resources
  getCourseResources: (courseId: string, params?: QueryParams) => 
    api.get<PaginatedResponse<Resource>>(API_ENDPOINTS.TEACHER.COURSE_RESOURCES(courseId), { params }),
  
  createResource: (data: ResourceCreateData) => 
    api.post<Resource>(API_ENDPOINTS.TEACHER.RESOURCES, data),
  
  updateResource: (id: string, data: ResourceUpdateData) => 
    api.put<Resource>(API_ENDPOINTS.TEACHER.RESOURCE_BY_ID(id), data),
  
  deleteResource: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.TEACHER.RESOURCE_BY_ID(id)),
  
  // Resource Comments
  getResourceComments: (resourceId: string) => 
    api.get<ResourceComment[]>(API_ENDPOINTS.TEACHER.RESOURCE_COMMENTS(resourceId)),
  
  createResourceComment: (resourceId: string, content: string) => 
    api.post<ResourceComment>(API_ENDPOINTS.TEACHER.RESOURCE_COMMENTS(resourceId), { content }),
  
  updateResourceComment: (commentId: string, content: string) => 
    api.put<ResourceComment>(API_ENDPOINTS.TEACHER.UPDATE_COMMENT(commentId), { content }),
  
  deleteResourceComment: (commentId: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.TEACHER.DELETE_COMMENT(commentId)),
}; 