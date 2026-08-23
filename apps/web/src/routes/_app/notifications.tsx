import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export interface NotificationsSearch {
  page: number;
  /** `true` narrows the list to unread rows — the API's own query name. */
  unreadOnly?: boolean;
}

/**
 * Search state lives in the URL, matching `announcements.tsx`'s reasoning: a
 * filtered view of the archive is the thing a user bookmarks or pastes into a
 * message, and if the filter were React state instead the link they send would
 * open unfiltered.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/notifications',
  validateSearch: (search: Record<string, unknown>): NotificationsSearch => {
    const page = Number(search.page);
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(search.unreadOnly === 'true' || search.unreadOnly === true ? { unreadOnly: true } : {}),
    };
  },
  head: () => ({ meta: [{ title: `Notifications · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Notifications'), 'NotificationsPage'),
});
