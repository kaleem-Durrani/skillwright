import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as adminLayout } from './admin.js';

export interface AdminCoursesSearch {
  page: number;
  q?: string;
}

export const Route = createRoute({
  getParentRoute: () => adminLayout,
  path: '/courses',
  validateSearch: (search: Record<string, unknown>): AdminCoursesSearch => {
    const page = Number(search.page);
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    };
  },
  head: () => ({ meta: [{ title: `Courses · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/AdminCourses'), 'AdminCoursesPage'),
});
