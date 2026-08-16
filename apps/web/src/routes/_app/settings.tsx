import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as appLayout } from '../_app.js';

export interface SettingsSearch {
  tab?: 'profile' | 'security' | 'notifications';
}

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): SettingsSearch =>
    search.tab === 'profile' || search.tab === 'security' || search.tab === 'notifications'
      ? { tab: search.tab }
      : {},
  component: lazyRouteComponent(() => import('@/pages/Settings'), 'SettingsPage'),
});
