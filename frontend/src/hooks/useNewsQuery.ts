import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QueryParams,
} from '../common/types';
import { newsApi } from '../api';

/**
 * Custom hook for news-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useNewsQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Query to get all published news events
   */
  const getAllPublishedNewsEventsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['news', 'published', params],
    queryFn: () => newsApi.getAllPublishedNewsEvents(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  /**
   * Query to get a specific published news event
   */
  const getPublishedNewsEventQuery = (id: string) => useQuery({
    queryKey: ['news', id],
    queryFn: () => newsApi.getPublishedNewsEvent(id),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Query to get comments on a news event
   */
  const getNewsEventCommentsQuery = (newsEventId: string) => useQuery({
    queryKey: ['news', newsEventId, 'comments'],
    queryFn: () => newsApi.getNewsEventComments(newsEventId),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: !!newsEventId, // Only run if newsEventId is provided
  });

  /**
   * Mutation for student creating a comment on a news event
   */
  const studentCreateNewsEventCommentMutation = useMutation({
    mutationFn: ({ newsEventId, content }: { newsEventId: string; content: string }) =>
      newsApi.studentCreateNewsEventComment(newsEventId, content),
    onSuccess: (_, variables) => {
      // Invalidate news event comments query
      queryClient.invalidateQueries({
        queryKey: ['news', variables.newsEventId, 'comments']
      });
    },
  });

  /**
   * Mutation for student updating a comment
   */
  const studentUpdateNewsEventCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      newsApi.studentUpdateNewsEventComment(commentId, content),
    onSuccess: () => {
      // Invalidate all news event comments queries
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });

  /**
   * Mutation for student deleting a comment
   */
  const studentDeleteNewsEventCommentMutation = useMutation({
    mutationFn: (commentId: string) => newsApi.studentDeleteNewsEventComment(commentId),
    onSuccess: () => {
      // Invalidate all news event comments queries
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });

  /**
   * Mutation for teacher creating a comment on a news event
   */
  const teacherCreateNewsEventCommentMutation = useMutation({
    mutationFn: ({ newsEventId, content }: { newsEventId: string; content: string }) =>
      newsApi.teacherCreateNewsEventComment(newsEventId, content),
    onSuccess: (_, variables) => {
      // Invalidate news event comments query
      queryClient.invalidateQueries({
        queryKey: ['news', variables.newsEventId, 'comments']
      });
    },
  });

  /**
   * Mutation for teacher updating a comment
   */
  const teacherUpdateNewsEventCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      newsApi.teacherUpdateNewsEventComment(commentId, content),
    onSuccess: () => {
      // Invalidate all news event comments queries
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });

  /**
   * Mutation for teacher deleting a comment
   */
  const teacherDeleteNewsEventCommentMutation = useMutation({
    mutationFn: (commentId: string) => newsApi.teacherDeleteNewsEventComment(commentId),
    onSuccess: () => {
      // Invalidate all news event comments queries
      queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });

  return {
    // News queries
    getAllPublishedNewsEventsQuery,
    getPublishedNewsEventQuery,
    getNewsEventCommentsQuery,

    // Student comment mutations
    studentCreateNewsEventCommentMutation,
    studentUpdateNewsEventCommentMutation,
    studentDeleteNewsEventCommentMutation,

    // Teacher comment mutations
    teacherCreateNewsEventCommentMutation,
    teacherUpdateNewsEventCommentMutation,
    teacherDeleteNewsEventCommentMutation,
  };
};

export default useNewsQuery;
