import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Student,
  QueryParams,
} from '../common/types';
import { studentApi } from '../api';

/**
 * Custom hook for student-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useStudentQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Query to get student profile
   */
  const getProfileQuery = useQuery({
    queryKey: ['student', 'profile'],
    queryFn: () => studentApi.getProfile(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Mutation for updating student profile
   */
  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<Omit<Student, 'id' | 'createdAt' | 'updatedAt'>>) =>
      studentApi.updateProfile(data),
    onSuccess: () => {
      // Invalidate profile query to refetch data
      queryClient.invalidateQueries({ queryKey: ['student', 'profile'] });
    },
  });

  /**
   * Query to get student's enrolled courses
   */
  const getEnrolledCoursesQuery = (params?: QueryParams) => useQuery({
    queryKey: ['student', 'courses', params],
    queryFn: () => studentApi.getEnrolledCourses(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  /**
   * Query to get a specific course by ID
   */
  const getCourseDetailsQuery = (id: string) => useQuery({
    queryKey: ['student', 'course', id],
    queryFn: () => studentApi.getCourseDetails(id),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for requesting enrollment in a course
   */
  const requestEnrollmentMutation = useMutation({
    mutationFn: (courseId: string) => studentApi.requestEnrollment(courseId),
    onSuccess: () => {
      // Invalidate enrolled courses list
      queryClient.invalidateQueries({ queryKey: ['student', 'courses'] });
    },
  });

  /**
   * Mutation for withdrawing from a course
   */
  const withdrawFromCourseMutation = useMutation({
    mutationFn: (courseId: string) => studentApi.withdrawFromCourse(courseId),
    onSuccess: (_, courseId) => {
      // Invalidate specific course query
      queryClient.invalidateQueries({ queryKey: ['student', 'course', courseId] });
      // Also invalidate enrolled courses list
      queryClient.invalidateQueries({ queryKey: ['student', 'courses'] });
    },
  });

  /**
   * Query to get resources in a course
   */
  const getCourseResourcesQuery = (courseId: string, params?: QueryParams) => useQuery({
    queryKey: ['student', 'course', courseId, 'resources', params],
    queryFn: () => studentApi.getCourseResources(courseId, params),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!courseId, // Only run if courseId is provided
  });

  /**
   * Query to get comments on a resource
   */
  const getResourceCommentsQuery = (resourceId: string) => useQuery({
    queryKey: ['student', 'resource', resourceId, 'comments'],
    queryFn: () => studentApi.getResourceComments(resourceId),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: !!resourceId, // Only run if resourceId is provided
  });

  /**
   * Mutation for creating a comment on a resource
   */
  const createResourceCommentMutation = useMutation({
    mutationFn: ({ resourceId, content }: { resourceId: string; content: string }) =>
      studentApi.createResourceComment(resourceId, content),
    onSuccess: (_, variables) => {
      // Invalidate resource comments query
      queryClient.invalidateQueries({
        queryKey: ['student', 'resource', variables.resourceId, 'comments']
      });
    },
  });

  /**
   * Mutation for updating a comment
   */
  const updateResourceCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      studentApi.updateResourceComment(commentId, content),
    onSuccess: () => {
      // Invalidate all resource comments queries
      queryClient.invalidateQueries({ queryKey: ['student', 'resource'] });
    },
  });

  /**
   * Mutation for deleting a comment
   */
  const deleteResourceCommentMutation = useMutation({
    mutationFn: (commentId: string) => studentApi.deleteResourceComment(commentId),
    onSuccess: () => {
      // Invalidate all resource comments queries
      queryClient.invalidateQueries({ queryKey: ['student', 'resource'] });
    },
  });

  return {
    // Profile queries and mutations
    getProfileQuery,
    updateProfileMutation,

    // Course queries and mutations
    getEnrolledCoursesQuery,
    getCourseDetailsQuery,
    requestEnrollmentMutation,
    withdrawFromCourseMutation,

    // Resource queries and mutations
    getCourseResourcesQuery,

    // Resource comments queries and mutations
    getResourceCommentsQuery,
    createResourceCommentMutation,
    updateResourceCommentMutation,
    deleteResourceCommentMutation,
  };
};

export default useStudentQuery;
