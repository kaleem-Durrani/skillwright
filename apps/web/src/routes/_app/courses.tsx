import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as appLayout } from '../_app.js';

export interface CoursesSearch {
  page: number;
  q?: string;
  departmentId?: string;
  status?: 'published' | 'draft';
}

/**
 * Search state lives in the URL, not in component state.
 *
 * WHY: a filtered course list is the thing a teacher pastes into a message. If
 * the filter is React state, the link they send opens an unfiltered list and the
 * conversation goes sideways.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/courses',
  validateSearch: (search: Record<string, unknown>): CoursesSearch => {
    const page = Number(search.page);
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
      ...(typeof search.departmentId === 'string' ? { departmentId: search.departmentId } : {}),
      ...(search.status === 'published' || search.status === 'draft'
        ? { status: search.status }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('@/pages/Courses'), 'CoursesPage'),
});
