import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Department,
  QueryParams,
} from '../common/types';
import { departmentApi } from '../api';

/**
 * Custom hook for department-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useDepartmentQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Query to get all departments with pagination
   */
  const getAllDepartmentsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['departments', params],
    queryFn: () => departmentApi.getAllDepartments(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Query to get a specific department by ID
   */
  const getDepartmentByIdQuery = (id: string) => useQuery({
    queryKey: ['department', id],
    queryFn: () => departmentApi.getDepartmentById(id),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for creating a department (admin only)
   */
  const createDepartmentMutation = useMutation({
    mutationFn: (data: Partial<Department>) => departmentApi.createDepartment(data),
    onSuccess: () => {
      // Invalidate departments list
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  /**
   * Mutation for updating a department (admin only)
   */
  const updateDepartmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Department> }) =>
      departmentApi.updateDepartment(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific department query
      queryClient.invalidateQueries({ queryKey: ['department', variables.id] });
      // Also invalidate departments list
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  /**
   * Mutation for deleting a department (admin only)
   */
  const deleteDepartmentMutation = useMutation({
    mutationFn: (id: string) => departmentApi.deleteDepartment(id),
    onSuccess: () => {
      // Invalidate departments list
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  return {
    // Department queries
    getAllDepartmentsQuery,
    getDepartmentByIdQuery,

    // Department mutations (admin only)
    createDepartmentMutation,
    updateDepartmentMutation,
    deleteDepartmentMutation,
  };
};

export default useDepartmentQuery;
