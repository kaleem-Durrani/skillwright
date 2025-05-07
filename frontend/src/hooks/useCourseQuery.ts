import { useQuery } from '@tanstack/react-query';
import {
  QueryParams,
} from '../common/types';
import { courseApi } from '../api';

/**
 * Custom hook for course-related queries
 * Uses TanStack Query for caching and state management
 */
export const useCourseQuery = () => {
  /**
   * Query to get all public courses with pagination
   */
  const getAllCoursesQuery = (params?: QueryParams) => useQuery({
    queryKey: ['courses', 'public', params],
    queryFn: () => courseApi.getAllCourses(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Query to get a specific public course by ID
   */
  const getCourseByIdQuery = (id: string) => useQuery({
    queryKey: ['course', 'public', id],
    queryFn: () => courseApi.getCourseById(id),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!id, // Only run if id is provided
  });

  return {
    // Public course queries
    getAllCoursesQuery,
    getCourseByIdQuery,
  };
};

export default useCourseQuery;
