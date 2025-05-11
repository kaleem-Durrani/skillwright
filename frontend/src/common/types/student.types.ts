import { Course, Resource, Enrollment, EnrollmentStatus, ResourceType, Conversation, Message, ConversationParticipant } from './models.types';
import { Student } from './auth.types';

// Extended types for student screens

/**
 * Course with enrollment information
 */
export interface CourseWithEnrollment extends Course {
  enrollments?: Array<{
    id: string;
    status: EnrollmentStatus;
    enrollmentDate?: string;
  }>;
  department?: {
    id: string;
    name: string;
  };
  teacher?: {
    id: string;
    name: string;
  };
}

/**
 * Resource with course and teacher information
 */
export interface ResourceWithDetails extends Resource {
  course?: {
    id: string;
    name: string;
    code: string;
  };
  teacher?: {
    id: string;
    name: string;
  };
}

/**
 * Student profile with department information
 */
export interface StudentWithDetails extends Student {
  department?: {
    id: string;
    name: string;
  };
  enrollments?: Array<{
    id: string;
    status: EnrollmentStatus;
    course: {
      id: string;
      name: string;
      code: string;
      description?: string;
    };
  }>;
}

/**
 * Conversation with participant details
 */
export interface ConversationWithDetails extends Conversation {
  participants: Array<ConversationParticipantWithDetails>;
}

/**
 * Conversation participant with user details
 */
export interface ConversationParticipantWithDetails extends ConversationParticipant {
  name?: string;
  email?: string;
  avatar?: string;
}

/**
 * Message with sender details
 */
export interface MessageWithDetails extends Message {
  senderName?: string;
  senderAvatar?: string;
}

/**
 * Table column definition for student screens
 */
export interface TableColumn<T> {
  title: string;
  dataIndex?: string;
  key?: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
  sorter?: boolean | ((a: T, b: T) => number);
  sortOrder?: 'ascend' | 'descend' | null;
  filters?: Array<{ text: string; value: any }>;
  onFilter?: (value: any, record: T) => boolean;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  children?: TableColumn<T>[];
  fixed?: 'left' | 'right' | boolean;
  ellipsis?: boolean;
  className?: string;
}

/**
 * Table pagination configuration
 */
export interface TablePagination {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize?: number) => void;
  showSizeChanger?: boolean;
  pageSizeOptions?: string[];
}

/**
 * Props for the reusable table component
 */
export interface TableProps<T> {
  columns: TableColumn<T>[];
  dataSource: T[];
  loading?: boolean;
  pagination?: TablePagination | false;
  rowKey?: string | ((record: T) => string);
  onChange?: (pagination: any, filters: any, sorter: any) => void;
  scroll?: { x?: number | string; y?: number | string };
  bordered?: boolean;
  size?: 'small' | 'middle' | 'large';
  title?: () => React.ReactNode;
  footer?: () => React.ReactNode;
  rowSelection?: any;
  expandable?: any;
}
