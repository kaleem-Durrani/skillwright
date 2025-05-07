import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QueryParams,
  ConversationCreateData,
} from '../common/types';
import { conversationApi } from '../api';

/**
 * Custom hook for conversation-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useConversationQuery = () => {
  const queryClient = useQueryClient();

  // Admin conversation hooks
  /**
   * Query to get admin conversations
   */
  const adminGetConversationsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['admin', 'conversations', params],
    queryFn: () => conversationApi.adminGetConversations(params),
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  /**
   * Query to get a specific admin conversation
   */
  const adminGetConversationQuery = (id: string) => useQuery({
    queryKey: ['admin', 'conversation', id],
    queryFn: () => conversationApi.adminGetConversation(id),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 10 * 1000, // Poll every 10 seconds for new messages
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for creating an admin conversation
   */
  const adminCreateConversationMutation = useMutation({
    mutationFn: (data: ConversationCreateData) =>
      conversationApi.adminCreateConversation(data),
    onSuccess: () => {
      // Invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
    },
  });

  /**
   * Mutation for sending a message in an admin conversation
   */
  const adminSendMessageMutation = useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      conversationApi.adminSendMessage(conversationId, content),
    onSuccess: (_, variables) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['admin', 'conversation', variables.conversationId] });
    },
  });

  /**
   * Mutation for leaving an admin conversation
   */
  const adminLeaveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      conversationApi.adminLeaveConversation(conversationId),
    onSuccess: (_, conversationId) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['admin', 'conversation', conversationId] });
      // Also invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['admin', 'conversations'] });
    },
  });

  // Teacher conversation hooks
  /**
   * Query to get teacher conversations
   */
  const teacherGetConversationsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['teacher', 'conversations', params],
    queryFn: () => conversationApi.teacherGetConversations(params),
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  /**
   * Query to get a specific teacher conversation
   */
  const teacherGetConversationQuery = (id: string) => useQuery({
    queryKey: ['teacher', 'conversation', id],
    queryFn: () => conversationApi.teacherGetConversation(id),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 10 * 1000, // Poll every 10 seconds for new messages
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for creating a teacher conversation
   */
  const teacherCreateConversationMutation = useMutation({
    mutationFn: (data: ConversationCreateData) =>
      conversationApi.teacherCreateConversation(data),
    onSuccess: () => {
      // Invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['teacher', 'conversations'] });
    },
  });

  /**
   * Mutation for sending a message in a teacher conversation
   */
  const teacherSendMessageMutation = useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      conversationApi.teacherSendMessage(conversationId, content),
    onSuccess: (_, variables) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['teacher', 'conversation', variables.conversationId] });
    },
  });

  /**
   * Mutation for leaving a teacher conversation
   */
  const teacherLeaveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      conversationApi.teacherLeaveConversation(conversationId),
    onSuccess: (_, conversationId) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['teacher', 'conversation', conversationId] });
      // Also invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['teacher', 'conversations'] });
    },
  });

  // Student conversation hooks
  /**
   * Query to get student conversations
   */
  const studentGetConversationsQuery = (params?: QueryParams) => useQuery({
    queryKey: ['student', 'conversations', params],
    queryFn: () => conversationApi.studentGetConversations(params),
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  /**
   * Query to get a specific student conversation
   */
  const studentGetConversationQuery = (id: string) => useQuery({
    queryKey: ['student', 'conversation', id],
    queryFn: () => conversationApi.studentGetConversation(id),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 10 * 1000, // Poll every 10 seconds for new messages
    enabled: !!id, // Only run if id is provided
  });

  /**
   * Mutation for creating a student conversation
   */
  const studentCreateConversationMutation = useMutation({
    mutationFn: (data: ConversationCreateData) =>
      conversationApi.studentCreateConversation(data),
    onSuccess: () => {
      // Invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['student', 'conversations'] });
    },
  });

  /**
   * Mutation for sending a message in a student conversation
   */
  const studentSendMessageMutation = useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      conversationApi.studentSendMessage(conversationId, content),
    onSuccess: (_, variables) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['student', 'conversation', variables.conversationId] });
    },
  });

  /**
   * Mutation for leaving a student conversation
   */
  const studentLeaveConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      conversationApi.studentLeaveConversation(conversationId),
    onSuccess: (_, conversationId) => {
      // Invalidate specific conversation query
      queryClient.invalidateQueries({ queryKey: ['student', 'conversation', conversationId] });
      // Also invalidate conversations list
      queryClient.invalidateQueries({ queryKey: ['student', 'conversations'] });
    },
  });

  return {
    // Admin conversation hooks
    adminGetConversationsQuery,
    adminGetConversationQuery,
    adminCreateConversationMutation,
    adminSendMessageMutation,
    adminLeaveConversationMutation,

    // Teacher conversation hooks
    teacherGetConversationsQuery,
    teacherGetConversationQuery,
    teacherCreateConversationMutation,
    teacherSendMessageMutation,
    teacherLeaveConversationMutation,

    // Student conversation hooks
    studentGetConversationsQuery,
    studentGetConversationQuery,
    studentCreateConversationMutation,
    studentSendMessageMutation,
    studentLeaveConversationMutation,
  };
};

export default useConversationQuery;
