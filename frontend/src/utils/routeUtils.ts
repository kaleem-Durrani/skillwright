/**
 * Utility functions for route handling
 */

/**
 * Determines the user type from the current path
 * @param path - The current path
 * @returns The user type (student, teacher, admin) or null if not found
 */
export const getUserTypeFromPath = (path: string): 'student' | 'teacher' | 'admin' | null => {
  if (path.startsWith('/student')) {
    return 'student';
  } else if (path.startsWith('/teacher')) {
    return 'teacher';
  } else if (path.startsWith('/admin')) {
    return 'admin';
  }
  return null;
};

/**
 * Gets the dashboard route for a specific user type
 * @param userType - The user type
 * @returns The dashboard route for the user type
 */
export const getDashboardRouteForUserType = (userType: 'student' | 'teacher' | 'admin'): string => {
  switch (userType) {
    case 'student':
      return '/student/dashboard';
    case 'teacher':
      return '/teacher/dashboard';
    case 'admin':
      return '/admin/dashboard';
    default:
      return '/';
  }
};
