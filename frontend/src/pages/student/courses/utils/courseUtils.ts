import { CourseWithEnrollment } from '@/common/types';

/**
 * Filter courses by enrollment status
 * @param courses List of courses
 * @param status Enrollment status to filter by
 * @returns Filtered courses
 */
export const filterCoursesByStatus = (
  courses: CourseWithEnrollment[],
  status: string
): CourseWithEnrollment[] => {
  return courses.filter(
    (course) => course.enrollments && course.enrollments[0]?.status === status
  );
};

/**
 * Get a set of course IDs from a list of courses
 * @param courses List of courses
 * @returns Set of course IDs
 */
export const getCourseIds = (courses: CourseWithEnrollment[]): Set<string> => {
  return new Set(courses.map((course) => course.id));
};

/**
 * Filter available courses (excluding enrolled ones)
 * @param allCourses All available courses
 * @param enrolledCourseIds Set of enrolled course IDs
 * @returns Available courses that are not enrolled
 */
export const filterAvailableCourses = (
  allCourses: CourseWithEnrollment[],
  enrolledCourseIds: Set<string>
): CourseWithEnrollment[] => {
  return allCourses.filter((course) => !enrolledCourseIds.has(course.id));
};
