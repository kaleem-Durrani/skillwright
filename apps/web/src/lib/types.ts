import type { Role } from '@skillwright/shared/policy';

/**
 * Wire shapes for the API responses this app reads.
 *
 * These mirror the Prisma models with two deliberate differences: dates are ISO
 * strings (JSON has no Date), and BigInt columns (`seq`, `nextSeq`) arrive as
 * strings, because a message sequence beyond 2^53 must not silently lose
 * precision on the way through JSON.parse.
 */

export type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED';

export type ResourceType = 'DOCUMENT' | 'VIDEO' | 'LINK';
export type AnnouncementType = 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';
export type DurationUnit = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
  avatarUrl: string | null;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DepartmentSummary {
  id: string;
  name: string;
  slug: string;
  courseCount: number;
}

export interface CourseSummary {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string | null;
  departmentId: string;
  departmentName: string;
  teacherId: string;
  teacherName: string;
  durationValue: number;
  durationUnit: DurationUnit;
  capacity: number;
  approvedCount: number;
  startDate: string | null;
  endDate: string | null;
  publishedAt: string | null;
  /** The caller's own enrolment, when there is one. */
  viewerEnrollmentStatus: EnrollmentStatus | null;
}

export interface ResourceSummary {
  id: string;
  title: string;
  description: string | null;
  type: ResourceType;
  courseId: string;
  authorId: string;
  authorName: string;
  isPublic: boolean;
  externalUrl: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

export interface EnrollmentSummary {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseId: string;
  courseName: string;
  status: EnrollmentStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface AnnouncementSummary {
  id: string;
  title: string;
  slug: string;
  content: string;
  type: AnnouncementType;
  authorId: string;
  authorName: string;
  eventDate: string | null;
  publishedAt: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  participants: Array<Pick<UserSummary, 'id' | 'name' | 'avatarUrl' | 'role'>>;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  /** BigInt on the wire — compare as BigInt, never as Number. */
  seq: string;
  content: string;
  clientMsgId: string;
  createdAt: string;
  editedAt: string | null;
}

export interface DashboardStats {
  courses: number;
  pendingEnrollments: number;
  unreadMessages: number;
  resources: number;
}
