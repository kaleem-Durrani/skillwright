import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LoginCredentials,
  TeacherSignupData,
  StudentSignupData,
  OtpVerificationData,
  PasswordResetData,
  AuthResponse,
} from "../common/types";
import { authApi } from "../api";

/**
 * Custom hook for authentication-related queries and mutations
 * Uses TanStack Query for caching and state management
 */
export const useAuthQuery = () => {
  const queryClient = useQueryClient();

  /**
   * Mutation for admin login
   */
  const adminLoginMutation = useMutation({
    mutationFn: (credentials: LoginCredentials) =>
      authApi.adminLogin(credentials),
    onSuccess: () => {
      // Invalidate any auth-related queries to refetch user data
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  /**
   * Mutation for admin logout
   */
  const adminLogoutMutation = useMutation({
    mutationFn: () => authApi.adminLogout(),
    onSuccess: () => {
      // Clear auth data and invalidate queries
      queryClient.setQueryData(["auth"], null);
      queryClient.invalidateQueries();
    },
  });

  /**
   * Mutation for teacher login
   */
  const teacherLoginMutation = useMutation({
    mutationFn: (credentials: LoginCredentials) =>
      authApi.teacherLogin(credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  /**
   * Mutation for teacher signup
   */
  const teacherSignupMutation = useMutation({
    mutationFn: (data: TeacherSignupData) => authApi.teacherSignup(data),
  });

  /**
   * Mutation for teacher OTP verification
   */
  const teacherVerifyOtpMutation = useMutation({
    mutationFn: (data: OtpVerificationData) => authApi.teacherVerifyOtp(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  /**
   * Mutation for teacher resend OTP
   */
  const teacherResendOtpMutation = useMutation({
    mutationFn: (email: string) => authApi.teacherResendOtp({ email }),
  });

  /**
   * Mutation for teacher forgot password
   */
  const teacherForgotPasswordMutation = useMutation({
    mutationFn: (email: string) => authApi.teacherForgotPassword({ email }),
  });

  /**
   * Mutation for teacher reset password
   */
  const teacherResetPasswordMutation = useMutation({
    mutationFn: (data: PasswordResetData) => authApi.teacherResetPassword(data),
  });

  /**
   * Mutation for teacher logout
   */
  const teacherLogoutMutation = useMutation({
    mutationFn: () => authApi.teacherLogout(),
    onSuccess: () => {
      queryClient.setQueryData(["auth"], null);
      queryClient.invalidateQueries();
    },
  });

  /**
   * Mutation for student login
   */
  const studentLoginMutation = useMutation({
    mutationFn: (credentials: LoginCredentials) =>
      authApi.studentLogin(credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  /**
   * Mutation for student signup
   */
  const studentSignupMutation = useMutation({
    mutationFn: (data: StudentSignupData) => authApi.studentSignup(data),
  });

  /**
   * Mutation for student OTP verification
   */
  const studentVerifyOtpMutation = useMutation({
    mutationFn: (data: OtpVerificationData) => authApi.studentVerifyOtp(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  /**
   * Mutation for student resend OTP
   */
  const studentResendOtpMutation = useMutation({
    mutationFn: (email: string) => authApi.studentResendOtp({ email }),
  });

  /**
   * Mutation for student forgot password
   */
  const studentForgotPasswordMutation = useMutation({
    mutationFn: (email: string) => authApi.studentForgotPassword({ email }),
  });

  /**
   * Mutation for student reset password
   */
  const studentResetPasswordMutation = useMutation({
    mutationFn: (data: PasswordResetData) => authApi.studentResetPassword(data),
  });

  /**
   * Mutation for student logout
   */
  const studentLogoutMutation = useMutation({
    mutationFn: () => authApi.studentLogout(),
    onSuccess: () => {
      queryClient.setQueryData(["auth"], null);
      queryClient.invalidateQueries();
    },
  });

  /**
   * Query for refreshing auth token
   */
  const refreshTokenMutation = useMutation({
    mutationFn: () => authApi.refreshToken(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  return {
    // Admin auth mutations
    adminLoginMutation,
    adminLogoutMutation,

    // Teacher auth mutations
    teacherLoginMutation,
    teacherSignupMutation,
    teacherVerifyOtpMutation,
    teacherResendOtpMutation,
    teacherForgotPasswordMutation,
    teacherResetPasswordMutation,
    teacherLogoutMutation,

    // Student auth mutations
    studentLoginMutation,
    studentSignupMutation,
    studentVerifyOtpMutation,
    studentResendOtpMutation,
    studentForgotPasswordMutation,
    studentResetPasswordMutation,
    studentLogoutMutation,

    // Token refresh
    refreshTokenMutation,
  };
};

export default useAuthQuery;
