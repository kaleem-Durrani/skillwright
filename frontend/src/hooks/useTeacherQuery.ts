import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { teacherApi } from '../api';

/**
 * Custom hook for teacher-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useTeacherQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Query to get teacher profile
   */
  const getProfileQuery = useQuery({
    queryKey: ['teacher', 'profile'],
    queryFn: () => teacherApi.getProfile(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Mutation for updating teacher profile
   */
  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<Omit<Teacher, 'id' | 'createdAt' | 'updatedAt'>>) => 
      teacherApi.updateProfile(data),
    onSuccess: () => {
      // Invalidate profile query to refetch data
      queryClient.invalidateQueries({ queryKey: ['teacher', 'profile'] });
    },
  });

  /**
   * Query to get teacher's courses
   */
  const getMyCoursesQuery = (params?: QueryParams) => useQuery({
    queryKey: ['teacher', 'courses', params],
    queryFn: () => teacherApi.getMyCourses(params),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  /**
   * Query to get a specific course by ID
   */
  const getCourseDetailsQuery = (id: string) => useQuery({
    queryKey: ['teacher', 'course', id],
    queryFn: () => teacherApi.getCourseDetails(id),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for creating a course
   */
  const createCourseMutation = useMutation({
    mutationFn: (data: CourseCreateData) => teacherApi.createCourse(data),
    onSuccess: () => {
      // Invalidate courses list
      queryClient.invalidateQueries({ queryKey: ['teacher', 'courses'] });
    },
  });

  /**
   * Mutation for updating a course
   */
  const updateCourseMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CourseUpdateData }) => 
      teacherApi.updateCourse(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific course query
      queryClient.invalidateQueries({ queryKey: ['teacher', 'course', variables.id] });
      // Also invalidate courses list
      queryClient.invalidateQueries({ queryKey: ['teacher', 'courses'] });
    },
  });

  /**
   * Mutation for deleting a course
   */
  const deleteCourseMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteCourse(id),
    onSuccess: () => {
      // Invalidate courses list
      queryClient.invalidateQueries({ queryKey: ['teacher', 'courses'] });
    },
  });

  /**
   * Query to get students in a course
   */
  const getCourseStudentsQuery = (courseId: string, params?: QueryParams) => useQuery({
    queryKey: ['teacher', 'course', courseId, 'students', params],
    queryFn: () => teacherApi.getCourseStudents(courseId, params),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!courseId, // Only run if courseId is provided
  });

  /**
   * Mutation for updating enrollment status
   */
  const updateEnrollmentStatusMutation = useMutation({
    mutationFn: ({ courseId, enrollmentId, status }: { 
      courseId: string; 
      enrollmentId: string; 
      status: string 
    }) => teacherApi.updateEnrollmentStatus(courseId, enrollmentId, status),
    onSuccess: (_, variables) => {
      // Invalidate course students query
      queryClient.invalidateQueries({ 
        queryKey: ['teacher', 'course', variables.courseId, 'students'] 
      });
    },
  });

  /**
   * Query to get resources in a course
   */
  const getCourseResourcesQuery = (courseId: string, params?: QueryParams) => useQuery({
    queryKey: ['teacher', 'course', courseId, 'resources', params],
    queryFn: () => teacherApi.getCourseResources(courseId, params),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!courseId, // Only run if courseId is provided
  });

  /**
   * Mutation for creating a resource
   */
  const createResourceMutation = useMutation({
    mutationFn: (data: ResourceCreateData) => teacherApi.createResource(data),
    onSuccess: (_, variables) => {
      // Invalidate course resources query
      queryClient.invalidateQueries({ 
        queryKey: ['teacher', 'course', variables.courseId, 'resources'] 
      });
    },
  });

  /**
   * Mutation for updating a resource
   */
  const updateResourceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResourceUpdateData }) => 
      teacherApi.updateResource(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific resource query
      queryClient.invalidateQueries({ queryKey: ['teacher', 'resource', variables.id] });
      // Also invalidate course resources list
      if (variables.data.courseId) {
        queryClient.invalidateQueries({ 
          queryKey: ['teacher', 'course', variables.data.courseId, 'resources'] 
        });
      }
    },
  });

  /**
   * Mutation for deleting a resource
   */
  const deleteResourceMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteResource(id),
    onSuccess: () => {
      // Invalidate all course resources queries
      queryClient.invalidateQueries({ queryKey: ['teacher', 'course'] });
    },
  });

  /**
   * Query to get comments on a resource
   */
  const getResourceCommentsQuery = (resourceId: string) => useQuery({
    queryKey: ['teacher', 'resource', resourceId, 'comments'],
    queryFn: () => teacherApi.getResourceComments(resourceId),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: !!resourceId, // Only run if resourceId is provided
  });

  /**
   * Mutation for creating a comment on a resource
   */
  const createResourceCommentMutation = useMutation({
    mutationFn: ({ resourceId, content }: { resourceId: string; content: string }) => 
      teacherApi.createResourceComment(resourceId, content),
    onSuccess: (_, variables) => {
      // Invalidate resource comments query
      queryClient.invalidateQueries({ 
        queryKey: ['teacher', 'resource', variables.resourceId, 'comments'] 
      });
    },
  });

  /**
   * Mutation for updating a comment
   */
  const updateResourceCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) => 
      teacherApi.updateResourceComment(commentId, content),
    onSuccess: () => {
      // Invalidate all resource comments queries
      queryClient.invalidateQueries({ queryKey: ['teacher', 'resource'] });
    },
  });

  /**
   * Mutation for deleting a comment
   */
  const deleteResourceCommentMutation = useMutation({
    mutationFn: (commentId: string) => teacherApi.deleteResourceComment(commentId),
    onSuccess: () => {
      // Invalidate all resource comments queries
      queryClient.invalidateQueries({ queryKey: ['teacher', 'resource'] });
    },
  });

  return {
    // Profile queries and mutations
    getProfileQuery,
    updateProfileMutation,

    // Course queries and mutations
    getMyCoursesQuery,
    getCourseDetailsQuery,
    createCourseMutation,
    updateCourseMutation,
    deleteCourseMutation,

    // Course students queries and mutations
    getCourseStudentsQuery,
    updateEnrollmentStatusMutation,

    // Resource queries and mutations
    getCourseResourcesQuery,
    createResourceMutation,
    updateResourceMutation,
    deleteResourceMutation,

    // Resource comments queries and mutations
    getResourceCommentsQuery,
    createResourceCommentMutation,
    updateResourceCommentMutation,
    deleteResourceCommentMutation,
  };
};

export default useTeacherQuery;
