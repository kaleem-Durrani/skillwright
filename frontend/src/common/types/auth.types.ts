export type UserType = 'admin' | 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  userType: UserType;
  isVerified?: boolean;
  isBanned?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Admin extends User {
  userType: 'admin';
  designation: string;
  isActive: boolean;
}

export interface Teacher extends User {
  userType: 'teacher';
  qualification: string;
  specialization?: string;
  phoneNumber?: string;
  departmentId: string;
  isBanned: boolean;
}

export interface Student extends User {
  userType: 'student';
  enrollmentNo: string;
  phoneNumber?: string;
  departmentId: string;
  isBanned: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData {
  name: string;
  email: string;
  password: string;
  phoneNumber?: string;
}

export interface TeacherSignupData extends SignupData {
  qualification: string;
  specialization?: string;
  departmentId: string;
}

export interface StudentSignupData extends SignupData {
  enrollmentNo: string;
  departmentId: string;
}

export interface OtpVerificationData {
  email: string;
  otp: string;
}

export interface PasswordResetData {
  email: string;
  otp: string;
  newPassword: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    name: string;
    email: string;
    userType: UserType;
  } | null;
} 