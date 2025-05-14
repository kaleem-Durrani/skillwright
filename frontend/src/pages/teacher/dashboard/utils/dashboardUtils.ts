import { Course, Resource } from '@/common/types';
import dayjs from 'dayjs';

/**
 * Calculate resource statistics from courses
 */
export const calculateResourceStats = (courses: Course[]) => {
  let documents = 0;
  let videos = 0;
  let links = 0;
  let total = 0;

  courses.forEach(course => {
    if (course.resources) {
      course.resources.forEach(resource => {
        total++;
        switch (resource.type) {
          case 'DOCUMENT':
            documents++;
            break;
          case 'VIDEO':
            videos++;
            break;
          case 'LINK':
            links++;
            break;
          default:
            documents++; // Default to document
        }
      });
    }
  });

  return {
    total,
    documents,
    videos,
    links
  };
};

/**
 * Generate upcoming events from courses
 */
export const generateUpcomingEvents = (courses: Course[]) => {
  const events: Array<{
    id: string;
    title: string;
    date: string;
    type: 'course_start' | 'course_end' | 'deadline';
    courseId?: string;
    courseName?: string;
  }> = [];

  courses.forEach(course => {
    if (course.startDate && dayjs(course.startDate).isAfter(dayjs())) {
      events.push({
        id: `start-${course.id}`,
        title: `${course.name} starts`,
        date: course.startDate,
        type: 'course_start',
        courseId: course.id,
        courseName: course.name
      });
    }

    if (course.endDate && dayjs(course.endDate).isAfter(dayjs())) {
      events.push({
        id: `end-${course.id}`,
        title: `${course.name} ends`,
        date: course.endDate,
        type: 'course_end',
        courseId: course.id,
        courseName: course.name
      });
    }
  });

  // Sort events by date
  return events.sort((a, b) => {
    return dayjs(a.date).valueOf() - dayjs(b.date).valueOf();
  });
};
