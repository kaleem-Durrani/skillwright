export const ROUTES = {
  // Public routes
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_EMAIL: '/verify-email',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password',
  
  // Admin routes
  ADMIN: {
    ROOT: '/admin',
    DASHBOARD: '/admin/dashboard',
    TEACHERS: '/admin/teachers',
    TEACHER_DETAILS: (id: string) => `/admin/teachers/${id}`,
    STUDENTS: '/admin/students',
    STUDENT_DETAILS: (id: string) => `/admin/students/${id}`,
    DEPARTMENTS: '/admin/departments',
    DEPARTMENT_DETAILS: (id: string) => `/admin/departments/${id}`,
    NEWS_EVENTS: '/admin/news-events',
    NEWS_EVENT_DETAILS: (id: string) => `/admin/news-events/${id}`,
    PROFILE: '/admin/profile',
    CONVERSATIONS: '/admin/conversations',
    CONVERSATION_DETAILS: (id: string) => `/admin/conversations/${id}`,
  },
  
  // Teacher routes
  TEACHER: {
    ROOT: '/teacher',
    DASHBOARD: '/teacher/dashboard',
    COURSES: '/teacher/courses',
    COURSE_DETAILS: (id: string) => `/teacher/courses/${id}`,
    COURSE_STUDENTS: (id: string) => `/teacher/courses/${id}/students`,
    RESOURCES: '/teacher/resources',
    RESOURCE_DETAILS: (id: string) => `/teacher/resources/${id}`,
    PROFILE: '/teacher/profile',
    CONVERSATIONS: '/teacher/conversations',
    CONVERSATION_DETAILS: (id: string) => `/teacher/conversations/${id}`,
  },
  
  // Student routes
  STUDENT: {
    ROOT: '/student',
    DASHBOARD: '/student/dashboard',
    COURSES: '/student/courses',
    COURSE_DETAILS: (id: string) => `/student/courses/${id}`,
    RESOURCES: '/student/resources',
    RESOURCE_DETAILS: (id: string) => `/student/resources/${id}`,
    PROFILE: '/student/profile',
    CONVERSATIONS: '/student/conversations',
    CONVERSATION_DETAILS: (id: string) => `/student/conversations/${id}`,
  },

  // Error routes
  ERROR: {
    NOT_FOUND: '/404',
    UNAUTHORIZED: '/401',
    FORBIDDEN: '/403',
    SERVER_ERROR: '/500',
  },
} as const; 