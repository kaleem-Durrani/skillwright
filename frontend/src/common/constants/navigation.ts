import { ROUTES } from './routes';

export const AUTH_MENU = [
  {
    label: 'Home',
    path: ROUTES.HOME,
  },
  {
    label: 'Login',
    path: ROUTES.LOGIN,
  },
  {
    label: 'Register',
    path: ROUTES.REGISTER,
  },
  {
    label: 'About',
    path: '/about',
  },
  {
    label: 'Contact',
    path: '/contact',
  },
] as const;

export const APP_MENU = {
  admin: [
    {
      label: 'Dashboard',
      path: ROUTES.ADMIN.DASHBOARD,
    },
    {
      label: 'Teachers',
      path: ROUTES.ADMIN.TEACHERS,
    },
    {
      label: 'Students',
      path: ROUTES.ADMIN.STUDENTS,
    },
    {
      label: 'Departments',
      path: ROUTES.ADMIN.DEPARTMENTS,
    },
    {
      label: 'News & Events',
      path: ROUTES.ADMIN.NEWS_EVENTS,
    },
  ],
  teacher: [
    {
      label: 'Dashboard',
      path: ROUTES.TEACHER.DASHBOARD,
    },
    {
      label: 'Courses',
      path: ROUTES.TEACHER.COURSES,
    },
    {
      label: 'Resources',
      path: ROUTES.TEACHER.RESOURCES,
    },
  ],
  student: [
    {
      label: 'Dashboard',
      path: ROUTES.STUDENT.DASHBOARD,
    },
    {
      label: 'Courses',
      path: ROUTES.STUDENT.COURSES,
    },
    {
      label: 'Resources',
      path: ROUTES.STUDENT.RESOURCES,
    },
  ],
} as const; 