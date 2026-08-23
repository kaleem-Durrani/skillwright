import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export interface SettingsSearch {
  tab?: 'profile' | 'security';
}

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): SettingsSearch =>
    search.tab === 'profile' || search.tab === 'security' ? { tab: search.tab } : {},
  head: () => ({ meta: [{ title: `Settings · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Settings'), 'SettingsPage'),
});
