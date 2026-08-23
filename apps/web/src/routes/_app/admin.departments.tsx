import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as adminLayout } from './admin.js';

export interface AdminDepartmentsSearch {
  page: number;
  q?: string;
}

export const Route = createRoute({
  getParentRoute: () => adminLayout,
  path: '/departments',
  validateSearch: (search: Record<string, unknown>): AdminDepartmentsSearch => {
    const page = Number(search.page);
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    };
  },
  head: () => ({ meta: [{ title: `Departments · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/AdminDepartments'), 'AdminDepartmentsPage'),
});
