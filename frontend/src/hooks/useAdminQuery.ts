import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Admin,
  QueryParams,
  DepartmentCreateData,
  DepartmentUpdateData,
  NewsEventCreateData,
  NewsEventUpdateData
} from '../common/types';
import { adminApi } from '../api';

/**
 * Custom hook for admin-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useAdminQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Query to get admin profile
   */
  const getProfileQuery = useQuery({
    queryKey: ['admin', 'profile'],
    queryFn: () => adminApi.getProfile(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Mutation for updating admin profile
   */
  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<Omit<Admin, 'id' | 'createdAt' | 'updatedAt'>>) =>
      adminApi.updateProfile(data),
    onSuccess: () => {
      // Invalidate profile query to refetch data
      queryClient.invalidateQueries({ queryKey: ['admin', 'profile'] });
    },
  });

  /**
   * Query to get all teachers with pagination
   */
  const getTeachersQuery = (params?: QueryParams) => useQuery({
    queryKey: ['admin', 'teachers', params],
    queryFn: () => adminApi.getAllTeachers(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  /**
   * Query to get a specific teacher by ID
   */
  const getTeacherByIdQuery = (id: string) => useQuery({
    queryKey: ['admin', 'teacher', id],
    queryFn: () => adminApi.getTeacherById(id),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for toggling teacher ban status
   */
  const toggleTeacherBanMutation = useMutation({
    mutationFn: (id: string) => adminApi.toggleTeacherBan(id),
    onSuccess: (_, id) => {
      // Invalidate specific teacher query
      queryClient.invalidateQueries({ queryKey: ['admin', 'teacher', id] });
      // Also invalidate teachers list
      queryClient.invalidateQueries({ queryKey: ['admin', 'teachers'] });
    },
  });

  /**
   * Mutation for deleting a teacher
   */
  const deleteTeacherMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteTeacher(id),
    onSuccess: () => {
      // Invalidate teachers list
      queryClient.invalidateQueries({ queryKey: ['admin', 'teachers'] });
    },
  });

  /**
   * Query to get all students with pagination
   */
  const getStudentsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['admin', 'students', params],
    queryFn: () => adminApi.getAllStudents(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  /**
   * Query to get a specific student by ID
   */
  const getStudentByIdQuery = (id: string) => useQuery({
    queryKey: ['admin', 'student', id],
    queryFn: () => adminApi.getStudentById(id),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for toggling student ban status
   */
  const toggleStudentBanMutation = useMutation({
    mutationFn: (id: string) => adminApi.toggleStudentBan(id),
    onSuccess: (_, id) => {
      // Invalidate specific student query
      queryClient.invalidateQueries({ queryKey: ['admin', 'student', id] });
      // Also invalidate students list
      queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });

  /**
   * Mutation for deleting a student
   */
  const deleteStudentMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteStudent(id),
    onSuccess: () => {
      // Invalidate students list
      queryClient.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });

  /**
   * Mutation for creating a department
   */
  const createDepartmentMutation = useMutation({
    mutationFn: (data: DepartmentCreateData) => adminApi.createDepartment(data),
    onSuccess: () => {
      // Invalidate departments list
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  /**
   * Mutation for updating a department
   */
  const updateDepartmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DepartmentUpdateData }) =>
      adminApi.updateDepartment(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific department query
      queryClient.invalidateQueries({ queryKey: ['department', variables.id] });
      // Also invalidate departments list
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  /**
   * Mutation for creating a news/event
   */
  const createNewsEventMutation = useMutation({
    mutationFn: (data: NewsEventCreateData) => adminApi.createNewsEvent(data),
    onSuccess: () => {
      // Invalidate news/events list
      queryClient.invalidateQueries({ queryKey: ['admin', 'newsEvents'] });
    },
  });

  /**
   * Mutation for updating a news/event
   */
  const updateNewsEventMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: NewsEventUpdateData }) =>
      adminApi.updateNewsEvent(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific news/event query
      queryClient.invalidateQueries({ queryKey: ['admin', 'newsEvent', variables.id] });
      // Also invalidate news/events list
      queryClient.invalidateQueries({ queryKey: ['admin', 'newsEvents'] });
      // Also invalidate public news list
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });

  return {
    // Profile queries and mutations
    getProfileQuery,
    updateProfileMutation,

    // Teacher queries and mutations
    getTeachersQuery,
    getTeacherByIdQuery,
    toggleTeacherBanMutation,
    deleteTeacherMutation,

    // Student queries and mutations
    getStudentsQuery,
    getStudentByIdQuery,
    toggleStudentBanMutation,
    deleteStudentMutation,

    // Department mutations
    createDepartmentMutation,
    updateDepartmentMutation,

    // News/Events mutations
    createNewsEventMutation,
    updateNewsEventMutation,
  };
};

export default useAdminQuery;
