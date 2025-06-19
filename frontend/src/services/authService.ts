import { api } from './api';
import { 
  LoginCredentials, 
  Admin, 
  Teacher, 
  Student,
  ApiResponse 
} from '../common/types';

export type UserType = 'admin' | 'teacher' | 'student';

// The backend returns user data directly, not nested under 'user'
export type LoginResponse = (Admin | Teacher | Student) & {
  userType: UserType;
};

export interface SignupData {
  name: string;
  email: string;
  password: string;
  phoneNumber?: string;
  qualification?: string; // For teachers
  specialization?: string; // For teachers
  departmentId?: string; // For teachers and students
  enrollmentNo?: string; // For students
}

export interface VerifyEmailData {
  email: string;
  otp: string;
}

export interface ForgotPasswordData {
  email: string;
  userType: UserType;
}

export interface ResetPasswordData {
  email: string;
  otp: string;
  newPassword: string;
  userType: UserType;
}

// The backend returns user data directly, not nested under 'user'
export type RefreshTokenResponse = (Admin | Teacher | Student) & {
  userType: UserType;
};

export const authService = {
  // Admin Authentication
  adminLogin: (credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/admin/login', credentials),

  adminSignup: (data: SignupData): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/admin/signup', data),

  adminLogout: (): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/admin/logout'),

  // Teacher Authentication
  teacherLogin: (credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/teacher/login', credentials),

  teacherSignup: (data: SignupData): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/teacher/signup', data),

  teacherLogout: (): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/teacher/logout'),

  // Student Authentication
  studentLogin: (credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/student/login', credentials),

  studentSignup: (data: SignupData): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/student/signup', data),

  studentLogout: (): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/student/logout'),

  // Email Verification (Teacher & Student)
  teacherVerifyOtp: (data: VerifyEmailData): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/teacher/verify-otp', data),

  teacherResendOtp: (email: string): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/teacher/resend-otp', { email }),

  studentVerifyOtp: (data: VerifyEmailData): Promise<ApiResponse<LoginResponse>> =>
    api.post('/auth/student/verify-otp', data),

  studentResendOtp: (email: string): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/student/resend-otp', { email }),

  // Password Reset (Teacher & Student)
  teacherForgotPassword: (email: string): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/teacher/forgot-password', { email }),

  teacherResetPassword: (data: ResetPasswordData): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/teacher/reset-password', data),

  studentForgotPassword: (email: string): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/student/forgot-password', { email }),

  studentResetPassword: (data: ResetPasswordData): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/student/reset-password', data),

  // Token Management
  refreshToken: (): Promise<ApiResponse<RefreshTokenResponse>> =>
    api.post('/auth/refresh'),

  // Profile endpoints
  getAdminProfile: (): Promise<ApiResponse<Admin>> =>
    api.get('/admin/profile'),

  getTeacherProfile: (): Promise<ApiResponse<Teacher>> =>
    api.get('/teacher/profile'),

  getStudentProfile: (): Promise<ApiResponse<Student>> =>
    api.get('/student/profile'),

  // Generic logout (will be called based on user type)
  logout: (): Promise<ApiResponse<{ message: string }>> =>
    api.post('/auth/logout'), // This will be handled by context to call the right endpoint
};
