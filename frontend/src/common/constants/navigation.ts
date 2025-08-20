import { ROUTES } from './routes';

export const AUTH_MENU = [
  {
    label: 'Home',
    path: '/',
  },
  {
    label: 'Courses',
    path: ROUTES.EXPLORE_COURSES,
  },
  {
    label: 'About',
    path: '#about',
  },
  {
    label: 'Contact',
    path: '#contact',
  },
  {
    label: 'Login',
    path: ROUTES.LOGIN,
  },
  {
    label: 'Register',
    path: ROUTES.REGISTER,
  },
] as const;

export const APP_MENU = {
  admin: [
    {
      label: 'Dashboard',
      path: ROUTES.ADMIN.DASHBOARD,
      icon: 'dashboard',
    },
    {
      label: 'Teachers',
      path: ROUTES.ADMIN.TEACHERS,
      icon: 'user',
    },
    {
      label: 'Students',
      path: ROUTES.ADMIN.STUDENTS,
      icon: 'team',
    },
    {
      label: 'Departments',
      path: ROUTES.ADMIN.DEPARTMENTS,
      icon: 'apartment',
    },
    {
      label: 'News & Events',
      path: ROUTES.ADMIN.NEWS_EVENTS,
      icon: 'notification',
    },
    {
      label: 'Profile',
      path: ROUTES.ADMIN.PROFILE,
      icon: 'user',
    },
    {
      label: 'Conversations',
      path: ROUTES.ADMIN.CONVERSATIONS,
      icon: 'message',
    },
  ],
  teacher: [
    {
      label: 'Dashboard',
      path: ROUTES.TEACHER.DASHBOARD,
      icon: 'dashboard',
    },
    {
      label: 'Courses',
      path: ROUTES.TEACHER.COURSES,
      icon: 'book',
    },
    {
      label: 'Resources',
      path: ROUTES.TEACHER.RESOURCES,
      icon: 'file',
    },
    {
      label: 'Profile',
      path: ROUTES.TEACHER.PROFILE,
      icon: 'user',
    },
    {
      label: 'Conversations',
      path: ROUTES.TEACHER.CONVERSATIONS,
      icon: 'message',
    },
  ],
  student: [
    {
      label: 'Dashboard',
      path: ROUTES.STUDENT.DASHBOARD,
      icon: 'dashboard',
    },
    {
      label: 'Courses',
      path: ROUTES.STUDENT.COURSES,
      icon: 'book',
    },
    {
      label: 'Resources',
      path: ROUTES.STUDENT.RESOURCES,
      icon: 'file',
    },
    {
      label: 'Profile',
      path: ROUTES.STUDENT.PROFILE,
      icon: 'user',
    },
    {
      label: 'Conversations',
      path: ROUTES.STUDENT.CONVERSATIONS,
      icon: 'message',
    },
  ],
} as const; 