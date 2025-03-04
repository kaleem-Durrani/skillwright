import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { Course, QueryParams, PaginatedResponse } from '../common/types';

export const courseApi = {
  // Get all courses (public)
  getAllCourses: (params?: QueryParams) => 
    api.get<PaginatedResponse<Course>>(API_ENDPOINTS.COURSES.LIST, { params }),
  
  // Get course by ID (public)
  getCourseById: (id: string) => 
    api.get<Course>(API_ENDPOINTS.COURSES.BY_ID(id)),
}; 