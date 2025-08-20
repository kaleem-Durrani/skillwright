import React, { lazy } from 'react';
import { ROUTES } from '../common/constants/routes';

// Public pages
const Home = lazy(() => import('../pages').then((module) => ({ default: module.Home })));
const Login = lazy(() => import('../pages').then((module) => ({ default: module.Login })));
const Register = lazy(() => import('../pages').then((module) => ({ default: module.Register })));
const ForgotPassword = lazy(() => import('../pages').then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import('../pages').then((module) => ({ default: module.ResetPassword })));
const VerifyEmail = lazy(() => import('../pages').then((module) => ({ default: module.VerifyEmail })));
const ExploreCourses = lazy(() => import('../pages').then((module) => ({ default: module.ExploreCourses })));

// Admin pages
const AdminDashboard = lazy(() => import('../pages').then((module) => ({ default: module.AdminDashboard })));
const AdminTeachers = lazy(() => import('../pages').then((module) => ({ default: module.AdminTeachers })));
const AdminStudents = lazy(() => import('../pages').then((module) => ({ default: module.AdminStudents })));
const AdminDepartments = lazy(() => import('../pages').then((module) => ({ default: module.AdminDepartments })));
const AdminNewsEvents = lazy(() => import('../pages').then((module) => ({ default: module.AdminNewsEvents })));
const AdminProfile = lazy(() => import('../pages').then((module) => ({ default: module.AdminProfile })));
const AdminConversations = lazy(() => import('../pages').then((module) => ({ default: module.AdminConversations })));

// Teacher pages
const TeacherDashboard = lazy(() => import('../pages').then((module) => ({ default: module.TeacherDashboard })));
const TeacherCourses = lazy(() => import('../pages').then((module) => ({ default: module.TeacherCourses })));
const TeacherResources = lazy(() => import('../pages').then((module) => ({ default: module.TeacherResources })));
const TeacherResourceComments = lazy(() => import('../pages').then((module) => ({ default: module.TeacherResourceComments })));
const TeacherProfile = lazy(() => import('../pages').then((module) => ({ default: module.TeacherProfile })));
const TeacherConversations = lazy(() => import('../pages').then((module) => ({ default: module.TeacherConversations })));

// Student pages
const StudentDashboard = lazy(() => import('../pages').then((module) => ({ default: module.StudentDashboard })));
const StudentCourses = lazy(() => import('../pages').then((module) => ({ default: module.StudentCourses })));
const StudentCourseDetails = lazy(() => import('../pages').then((module) => ({ default: module.StudentCourseDetails })));
const StudentResources = lazy(() => import('../pages').then((module) => ({ default: module.StudentResources })));
const StudentResourceComments = lazy(() => import('../pages').then((module) => ({ default: module.StudentResourceComments })));
const StudentProfile = lazy(() => import('../pages').then((module) => ({ default: module.StudentProfile })));
const StudentConversations = lazy(() => import('../pages').then((module) => ({ default: module.StudentConversations })));

// Error pages
const NotFound = lazy(() => import('../pages').then((module) => ({ default: module.NotFound })));
const Unauthorized = lazy(() => import('../pages').then((module) => ({ default: module.Unauthorized })));
const Forbidden = lazy(() => import('../pages').then((module) => ({ default: module.Forbidden })));
const ServerError = lazy(() => import('../pages').then((module) => ({ default: module.ServerError })));

export type RouteType = {
  path: string;
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  protected?: boolean;
  userType?: 'admin' | 'teacher' | 'student';
  requiresVerification?: boolean;
};

// Public routes
export const publicRoutes: RouteType[] = [
  { path: ROUTES.HOME, component: Home },
  { path: ROUTES.LOGIN, component: Login },
  { path: ROUTES.REGISTER, component: Register },
  { path: ROUTES.FORGOT_PASSWORD, component: ForgotPassword },
  { path: ROUTES.RESET_PASSWORD, component: ResetPassword },
  { path: ROUTES.EXPLORE_COURSES, component: ExploreCourses },
];

// Protected routes that require verification
export const verificationRoutes: RouteType[] = [
  { 
    path: ROUTES.VERIFY_EMAIL, 
    component: VerifyEmail, 
    protected: true,
    requiresVerification: true 
  },
];

// Admin routes
export const adminRoutes: RouteType[] = [
  { path: ROUTES.ADMIN.DASHBOARD, component: AdminDashboard, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.TEACHERS, component: AdminTeachers, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.STUDENTS, component: AdminStudents, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.DEPARTMENTS, component: AdminDepartments, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.NEWS_EVENTS, component: AdminNewsEvents, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.PROFILE, component: AdminProfile, protected: true, userType: 'admin', requiresVerification: false },
  { path: ROUTES.ADMIN.CONVERSATIONS, component: AdminConversations, protected: true, userType: 'admin', requiresVerification: false },
];

// Teacher routes
export const teacherRoutes: RouteType[] = [
  { path: ROUTES.TEACHER.DASHBOARD, component: TeacherDashboard, protected: true, userType: 'teacher', requiresVerification: false },
  { path: ROUTES.TEACHER.COURSES, component: TeacherCourses, protected: true, userType: 'teacher', requiresVerification: false },
  { path: ROUTES.TEACHER.RESOURCES, component: TeacherResources, protected: true, userType: 'teacher', requiresVerification: false },
  { path: ROUTES.TEACHER.RESOURCE_COMMENTS(':resourceId'), component: TeacherResourceComments, protected: true, userType: 'teacher', requiresVerification: false },
  { path: ROUTES.TEACHER.PROFILE, component: TeacherProfile, protected: true, userType: 'teacher', requiresVerification: false },
  { path: ROUTES.TEACHER.CONVERSATIONS, component: TeacherConversations, protected: true, userType: 'teacher', requiresVerification: false },
];

// Student routes
export const studentRoutes: RouteType[] = [
  { path: ROUTES.STUDENT.DASHBOARD, component: StudentDashboard, protected: true, userType: 'student', requiresVerification: false },
  { path: ROUTES.STUDENT.COURSES, component: StudentCourses, protected: true, userType: 'student', requiresVerification: false },
  { path: '/student/courses/:courseId', component: StudentCourseDetails, protected: true, userType: 'student', requiresVerification: false },
  { path: ROUTES.STUDENT.RESOURCES, component: StudentResources, protected: true, userType: 'student', requiresVerification: false },
  { path: '/student/resources/:resourceId/comments', component: StudentResourceComments, protected: true, userType: 'student', requiresVerification: false },
  { path: ROUTES.STUDENT.PROFILE, component: StudentProfile, protected: true, userType: 'student', requiresVerification: false },
  { path: ROUTES.STUDENT.CONVERSATIONS, component: StudentConversations, protected: true, userType: 'student', requiresVerification: false },
];

// Error routes
export const errorRoutes: RouteType[] = [
  { path: ROUTES.ERROR.NOT_FOUND, component: NotFound },
  { path: ROUTES.ERROR.UNAUTHORIZED, component: Unauthorized },
  { path: ROUTES.ERROR.FORBIDDEN, component: Forbidden },
  { path: ROUTES.ERROR.SERVER_ERROR, component: ServerError },
];

// Combine all routes
export const routes: RouteType[] = [
  ...publicRoutes,
  ...verificationRoutes,
  ...adminRoutes,
  ...teacherRoutes,
  ...studentRoutes,
  ...errorRoutes,
  // Catch-all route for 404
  { path: '*', component: NotFound },
]; 