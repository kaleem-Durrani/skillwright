export const API_BASE_URL = 'http://localhost:5000/api';

export const API_ENDPOINTS = {
  AUTH: {
    ADMIN: {
      LOGIN: '/auth/admin/login',
      LOGOUT: '/auth/admin/logout',
      SIGNUP: '/auth/admin/signup', // restricted route
    },
    TEACHER: {
      LOGIN: '/auth/teacher/login',
      LOGOUT: '/auth/teacher/logout',
      SIGNUP: '/auth/teacher/signup',
      VERIFY_OTP: '/auth/teacher/verify-otp',
      RESEND_OTP: '/auth/teacher/resend-otp',
      FORGOT_PASSWORD: '/auth/teacher/forgot-password',
      RESET_PASSWORD: '/auth/teacher/reset-password',
    },
    STUDENT: {
      LOGIN: '/auth/student/login',
      LOGOUT: '/auth/student/logout',
      SIGNUP: '/auth/student/signup',
      VERIFY_OTP: '/auth/student/verify-otp',
      RESEND_OTP: '/auth/student/resend-otp',
      FORGOT_PASSWORD: '/auth/student/forgot-password',
      RESET_PASSWORD: '/auth/student/reset-password',
    },
    REFRESH: '/auth/refresh',
  },

  ADMIN: {
    PROFILE: '/admin/profile',
    TEACHERS: '/admin/teachers',
    TEACHERS_BY_ID: (id: string) => `/admin/teachers/${id}`,
    TOGGLE_TEACHER_BAN: (id: string) => `/admin/teachers/${id}/ban`,
    DELETE_TEACHER: (id: string) => `/admin/teachers/${id}`,

    STUDENTS: '/admin/students',
    STUDENTS_BY_ID: (id: string) => `/admin/students/${id}`,
    TOGGLE_STUDENT_BAN: (id: string) => `/admin/students/${id}/ban`,
    DELETE_STUDENT: (id: string) => `/admin/students/${id}`,

    NEWS_EVENTS: '/admin/news-events',
    NEWS_EVENTS_BY_ID: (id: string) => `/admin/news-events/${id}`,
    TOGGLE_NEWS_EVENT_PUBLISH: (id: string) => `/admin/news-events/${id}/publish`,
  },

  TEACHER: {
    PROFILE: '/teacher/profile',
    COURSES: '/teacher/courses',
    COURSE_DETAILS: (id: string) => `/teacher/courses/${id}`,
    COURSE_STUDENTS: (id: string) => `/teacher/courses/${id}/students`,
    COURSE_RESOURCES: (id: string) => `/teacher/courses/${id}/resources`,
    UPDATE_ENROLLMENT: (courseId: string, enrollmentId: string) =>
      `/teacher/courses/${courseId}/enrollments/${enrollmentId}`,

    RESOURCES: '/teacher/resources',
    RESOURCE_BY_ID: (id: string) => `/teacher/resources/${id}`,
    RESOURCE_COMMENTS: (id: string) => `/teacher/resources/${id}/comments`,
    UPDATE_COMMENT: (commentId: string) => `/teacher/resources/comments/${commentId}`,
    DELETE_COMMENT: (commentId: string) => `/teacher/resources/comments/${commentId}`,
  },

  STUDENT: {
    PROFILE: '/student/profile',
    COURSES: '/student/courses',
    COURSE_DETAILS: (id: string) => `/student/courses/${id}`,
    COURSE_RESOURCES: (id: string) => `/student/courses/${id}/resources`,
    ENROLL_COURSE: (id: string) => `/student/courses/${id}/enroll`,
    WITHDRAW_COURSE: (id: string) => `/student/courses/${id}/withdraw`,

    RESOURCE_COMMENTS: (resourceId: string) => `/student/resources/${resourceId}/comments`,
    UPDATE_COMMENT: (commentId: string) => `/student/resources/comments/${commentId}`,
    DELETE_COMMENT: (commentId: string) => `/student/resources/comments/${commentId}`,
  },

  DEPARTMENTS: {
    LIST: '/department',
    BY_ID: (id: string) => `/department/${id}`,
  },

  COURSES: {
    LIST: '/courses',
    BY_ID: (id: string) => `/courses/${id}`,
  },

  RESOURCES: {
    PUBLIC: '/resources/public',
    PUBLIC_BY_ID: (id: string) => `/resources/public/${id}`,
  },

  CONVERSATIONS: {
    ADMIN: {
      LIST: '/conversations/admin',
      BY_ID: (id: string) => `/conversations/admin/${id}`,
      CREATE: '/conversations/admin',
      MESSAGES: (id: string) => `/conversations/admin/${id}/messages`,
      LEAVE: (id: string) => `/conversations/admin/${id}/leave`,
    },
    TEACHER: {
      LIST: '/conversations/teacher',
      BY_ID: (id: string) => `/conversations/teacher/${id}`,
      CREATE: '/conversations/teacher',
      MESSAGES: (id: string) => `/conversations/teacher/${id}/messages`,
      LEAVE: (id: string) => `/conversations/teacher/${id}/leave`,
    },
    STUDENT: {
      LIST: '/conversations/student',
      BY_ID: (id: string) => `/conversations/student/${id}`,
      CREATE: '/conversations/student',
      MESSAGES: (id: string) => `/conversations/student/${id}/messages`,
      LEAVE: (id: string) => `/conversations/student/${id}/leave`,
    },
  },

  NEWS: {
    LIST: '/news',
    BY_ID: (id: string) => `/news/${id}`,
    COMMENTS: (id: string) => `/news/${id}/comments`,
    STUDENT_COMMENT: (id: string) => `/news/${id}/comments`,
    TEACHER_COMMENT: (id: string) => `/news/${id}/comments/teacher`,
    UPDATE_STUDENT_COMMENT: (commentId: string) => `/news/comments/${commentId}`,
    DELETE_STUDENT_COMMENT: (commentId: string) => `/news/comments/${commentId}`,
    UPDATE_TEACHER_COMMENT: (commentId: string) => `/news/comments/${commentId}/teacher`,
    DELETE_TEACHER_COMMENT: (commentId: string) => `/news/comments/${commentId}/teacher`,
  },
};