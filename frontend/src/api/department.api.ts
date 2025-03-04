import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import { Department, QueryParams, PaginatedResponse } from '../common/types';

export const departmentApi = {
  // Get all departments
  getAllDepartments: (params?: QueryParams) => 
    api.get<PaginatedResponse<Department>>(API_ENDPOINTS.DEPARTMENTS.LIST, { params }),
  
  // Get department by ID
  getDepartmentById: (id: string) => 
    api.get<Department>(API_ENDPOINTS.DEPARTMENTS.BY_ID(id)),
  
  // Create department (admin only)
  createDepartment: (data: Partial<Department>) => 
    api.post<Department>(API_ENDPOINTS.DEPARTMENTS.LIST, data),
  
  // Update department (admin only)
  updateDepartment: (id: string, data: Partial<Department>) => 
    api.put<Department>(API_ENDPOINTS.DEPARTMENTS.BY_ID(id), data),
  
  // Delete department (admin only)
  deleteDepartment: (id: string) => 
    api.delete<{ success: boolean; message: string }>(API_ENDPOINTS.DEPARTMENTS.BY_ID(id)),
}; 