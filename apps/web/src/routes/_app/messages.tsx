import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export interface MessagesSearch {
  /** Which thread is open. On mobile this is what switches list → thread. */
  conversationId?: string;
}

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/messages',
  validateSearch: (search: Record<string, unknown>): MessagesSearch =>
    typeof search.conversationId === 'string' ? { conversationId: search.conversationId } : {},
  head: () => ({ meta: [{ title: `Messages · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Messages'), 'MessagesPage'),
});
