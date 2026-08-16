import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as adminLayout } from './admin.js';

export interface AdminUsersSearch {
  page: number;
  q?: string;
  role?: 'STUDENT' | 'TEACHER' | 'ADMIN';
  status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
}

export const Route = createRoute({
  getParentRoute: () => adminLayout,
  path: '/users',
  validateSearch: (search: Record<string, unknown>): AdminUsersSearch => {
    const page = Number(search.page);
    const role = search.role;
    const status = search.status;
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
      ...(role === 'STUDENT' || role === 'TEACHER' || role === 'ADMIN' ? { role } : {}),
      ...(status === 'PENDING_VERIFICATION' || status === 'ACTIVE' || status === 'SUSPENDED'
        ? { status }
        : {}),
    };
  },
  component: lazyRouteComponent(() => import('@/pages/AdminUsers'), 'AdminUsersPage'),
});
