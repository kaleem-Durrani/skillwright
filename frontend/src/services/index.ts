// Re-export all services
export { api } from './api';
export { authService } from './authService';
export { adminService } from './adminService';
export { teacherService } from './teacherService';
export { studentService } from './studentService';
export { departmentService } from './departmentService';
export { courseService } from './courseService';
export { newsService } from './newsService';
export { resourceService } from './resourceService';
export { conversationService } from './conversationService';
export { webSocketService } from './webSocketService';

// Re-export types
export type { UserType, LoginResponse, SignupData } from './authService';
export type { PaginatedResponse as AdminPaginatedResponse, QueryParams as AdminQueryParams } from './adminService';
export type { PaginatedResponse as TeacherPaginatedResponse, QueryParams as TeacherQueryParams } from './teacherService';
export type { PaginatedResponse as StudentPaginatedResponse, QueryParams as StudentQueryParams } from './studentService';
export type { PaginatedResponse as DepartmentPaginatedResponse, QueryParams as DepartmentQueryParams } from './departmentService';
export type { PaginatedResponse as CoursePaginatedResponse, QueryParams as CourseQueryParams } from './courseService';
export type { PaginatedResponse as NewsPaginatedResponse, QueryParams as NewsQueryParams } from './newsService';
export type { PaginatedResponse as ResourcePaginatedResponse, QueryParams as ResourceQueryParams } from './resourceService';
export type { PaginatedResponse as ConversationPaginatedResponse, QueryParams as ConversationQueryParams } from './conversationService';
