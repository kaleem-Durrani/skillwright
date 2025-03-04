import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { 
  Admin, 
  Teacher, 
  Student, 
  QueryParams, 
  PaginatedResponse,
  DepartmentCreateData,
  DepartmentUpdateData,
  NewsEventCreateData,
  NewsEventUpdateData
} from '../common/types';

export const adminApi = {
  // Profile
  getProfile: () => 
    api.get<Admin>(API_ENDPOINTS.ADMIN.PROFILE),
  
  updateProfile: (data: Partial<Omit<Admin, 'id' | 'createdAt' | 'updatedAt'>>) => 
    api.put<Admin>(API_ENDPOINTS.ADMIN.PROFILE, data),
  
  // Teachers
  getAllTeachers: (params?: QueryParams) => 
    api.get<PaginatedResponse<Teacher>>(API_ENDPOINTS.ADMIN.TEACHERS, { params }),
  
  getTeacherById: (id: string) => 
    api.get<Teacher>(API_ENDPOINTS.ADMIN.TEACHERS_BY_ID(id)),
  
  toggleTeacherBan: (id: string) => 
    api.put<Teacher>(API_ENDPOINTS.ADMIN.TOGGLE_TEACHER_BAN(id)),
  
  deleteTeacher: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.ADMIN.DELETE_TEACHER(id)),
  
  // Students
  getAllStudents: (params?: QueryParams) => 
    api.get<PaginatedResponse<Student>>(API_ENDPOINTS.ADMIN.STUDENTS, { params }),
  
  getStudentById: (id: string) => 
    api.get<Student>(API_ENDPOINTS.ADMIN.STUDENTS_BY_ID(id)),
  
  toggleStudentBan: (id: string) => 
    api.put<Student>(API_ENDPOINTS.ADMIN.TOGGLE_STUDENT_BAN(id)),
  
  deleteStudent: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.ADMIN.DELETE_STUDENT(id)),
  
  // Departments
  createDepartment: (data: DepartmentCreateData) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.DEPARTMENTS.LIST, data),
  
  updateDepartment: (id: string, data: DepartmentUpdateData) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.DEPARTMENTS.BY_ID(id), data),
  
  // News & Events
  createNewsEvent: (data: NewsEventCreateData) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.ADMIN.NEWS_EVENTS, data),
  
  updateNewsEvent: (id: string, data: NewsEventUpdateData) => 
    api.put<{ success: boolean; message: string }>(API_ENDPOINTS.ADMIN.NEWS_EVENTS_BY_ID(id), data),
}; 