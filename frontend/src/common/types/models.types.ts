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
  createdAt: string;
  updatedAt: string;
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