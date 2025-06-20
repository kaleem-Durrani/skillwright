// Response types (what we receive from the backend)
export interface Teacher {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  qualification: string;
  specialization?: string;
  departmentId: string;
  department?: {
    id: string;
    name: string;
  };
  isBanned: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    courses: number;
    resources: number;
  };
}

export interface Student {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  enrollmentNo: string;
  departmentId: string;
  department?: {
    id: string;
    name: string;
  };
  isBanned: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    enrollments: number;
  };
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    teachers: number;
    students: number;
    courses: number;
  };
}

export interface Course {
  id: string;
  name: string;
  code: string;
  description?: string;
  duration: string;
  capacity?: number;
  departmentId: string;
  teacherId: string;
  syllabus?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  department?: {
    id: string;
    name: string;
  };
  teacher?: {
    id: string;
    name: string;
    qualification?: string;
    specialization?: string;
  };
  enrollmentId?: string;
  enrolledAt?: string;
  requestedAt?: string;
  enrollmentStatus?: EnrollmentStatus | null;
  canEnroll?: boolean;
  _count?: {
    enrollments: number;
    resources: number;
  };
}

export interface Resource {
  id: string;
  title: string;
  description?: string;
  type: ResourceType;
  url: string;
  courseId: string;
  teacherId: string;
  isPublic: boolean;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
  course?: {
    id: string;
    name: string;
    code: string;
  };
  teacher?: {
    id: string;
    name: string;
  };
  _count?: {
    comments: number;
  };
}

export type ResourceType = 'DOCUMENT' | 'VIDEO' | 'LINK';

export interface ResourceComment {
  id: string;
  content: string;
  resourceId: string;
  userId: string;
  userType: 'teacher' | 'student';
  createdAt: string;
  updatedAt: string;
}

export interface NewsEvent {
  id: string;
  title: string;
  content: string;
  type: NewsEventType;
  date: string;
  isPublished: boolean;
  adminId: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    comments: number;
  };
}

export type NewsEventType = 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';

export interface NewsEventComment {
  id: string;
  content: string;
  newsEventId: string;
  userId: string;
  userType: 'teacher' | 'student';
  createdAt: string;
  updatedAt: string;
}

export interface NewsEventCommentCreateData {
  content: string;
}

export interface NewsEventCommentUpdateData {
  content: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  courseId: string;
  status: EnrollmentStatus;
  enrollmentDate: string;
  createdAt: string;
  updatedAt: string;
}

export type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export interface Conversation {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
  messages: Message[];
  _count?: {
    participants: number;
    messages: number;
  };
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  userId: string;
  userType: 'admin' | 'teacher' | 'student';
  hasLeft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  content: string;
  conversationId: string;
  senderId: string;
  senderType: 'admin' | 'teacher' | 'student';
  createdAt: string;
  updatedAt: string;
}

// Request types (what we send to the backend)
export interface DepartmentCreateData {
  name: string;
  description?: string;
}

export interface DepartmentUpdateData {
  name?: string;
  description?: string;
}

export interface CourseCreateData {
  name: string;
  code: string;
  description?: string;
  duration: string;
  capacity?: number;
  departmentId: string;
  syllabus?: string;
  startDate?: string;
  endDate?: string;
}

export interface CourseUpdateData {
  name?: string;
  code?: string;
  description?: string;
  duration?: string;
  capacity?: number;
  departmentId?: string;
  syllabus?: string;
  startDate?: string;
  endDate?: string;
}

export interface ResourceCreateData {
  title: string;
  description?: string;
  type: ResourceType;
  url: string;
  courseId: string;
  isPublic: boolean;
}

export interface ResourceUpdateData {
  title?: string;
  description?: string;
  type?: ResourceType;
  url?: string;
  courseId?: string;
  isPublic?: boolean;
}

export interface TeacherCreateData {
  name: string;
  email: string;
  password: string;
  phoneNumber?: string;
  qualification: string;
  specialization?: string;
  departmentId?: string;
}

export interface NewsEventCreateData {
  title: string;
  content: string;
  type: NewsEventType;
  date: string;
  isPublished?: boolean;
}

export interface NewsEventUpdateData {
  title?: string;
  content?: string;
  type?: NewsEventType;
  date?: string;
  isPublished?: boolean;
}

export interface ConversationCreateData {
  title?: string;
  participants: {
    userId: string;
    userType: 'admin' | 'teacher' | 'student';
  }[];
}

export interface MessageCreateData {
  content: string;
}

// Dashboard types
export interface DashboardStats {
  enrolledCourses: number;
  pendingRequests: number;
  totalResources: number;
}

export interface StudentDashboardData {
  stats: DashboardStats;
  recentCourses: Course[];
  recentResources: Resource[];
  recentNews: NewsEvent[];
}