import { api } from './apiClient';
import { API_ENDPOINTS } from '../common/constants';
import {
  LoginCredentials,
  AuthResponse,
  TeacherSignupData,
  StudentSignupData,
  OtpVerificationData,
  PasswordResetData,
} from '../common/types';

export const authApi = {
  // Admin auth
  adminLogin: (data: LoginCredentials) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.ADMIN.LOGIN, data),
  
  adminLogout: () => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.ADMIN.LOGOUT),
  
  // Teacher auth
  teacherLogin: (data: LoginCredentials) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.TEACHER.LOGIN, data),
  
  teacherSignup: (data: TeacherSignupData) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.TEACHER.SIGNUP, data),
  
  teacherVerifyOtp: (data: OtpVerificationData) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.TEACHER.VERIFY_OTP, data),
  
  teacherResendOtp: (data: { email: string }) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.TEACHER.RESEND_OTP, data),
  
  teacherForgotPassword: (data: { email: string }) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.TEACHER.FORGOT_PASSWORD, data),
  
  teacherResetPassword: (data: PasswordResetData) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.TEACHER.RESET_PASSWORD, data),
  
  teacherLogout: () => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.TEACHER.LOGOUT),
  
  // Student auth
  studentLogin: (data: LoginCredentials) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.STUDENT.LOGIN, data),
  
  studentSignup: (data: StudentSignupData) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.STUDENT.SIGNUP, data),
  
  studentVerifyOtp: (data: OtpVerificationData) => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.STUDENT.VERIFY_OTP, data),
  
  studentResendOtp: (data: { email: string }) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.STUDENT.RESEND_OTP, data),
  
  studentForgotPassword: (data: { email: string }) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.STUDENT.FORGOT_PASSWORD, data),
  
  studentResetPassword: (data: PasswordResetData) => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.STUDENT.RESET_PASSWORD, data),
  
  studentLogout: () => 
    api.post<{ success: boolean; message: string }>(API_ENDPOINTS.AUTH.STUDENT.LOGOUT),
  
  // Refresh token
  refreshToken: () => 
    api.post<AuthResponse>(API_ENDPOINTS.AUTH.REFRESH),
}; 