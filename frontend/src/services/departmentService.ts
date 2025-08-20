import { api } from './api';
import { 
  Department,
  ApiResponse,
  DepartmentCreateData,
  DepartmentUpdateData
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
}

export interface DepartmentSelectOption {
  value: string;
  label: string;
}

export const departmentService = {
  // Get all departments (with pagination) - for tables
  getDepartments: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Department>>> =>
    api.get('/departments', { params }),

  // Get departments for select components (no pagination, only id and name)
  getDepartmentsForSelect: (): Promise<ApiResponse<DepartmentSelectOption[]>> =>
    api.get('/departments/select'),

  // Get department by ID
  getDepartmentById: (id: string): Promise<ApiResponse<Department>> =>
    api.get(`/departments/${id}`),

  // Create department (Admin only)
  createDepartment: (data: DepartmentCreateData): Promise<ApiResponse<Department>> =>
    api.post('/departments', data),

  // Update department (Admin only)
  updateDepartment: (id: string, data: DepartmentUpdateData): Promise<ApiResponse<Department>> =>
    api.put(`/departments/${id}`, data),

  // Delete department (Admin only)
  deleteDepartment: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/departments/${id}`),
};
