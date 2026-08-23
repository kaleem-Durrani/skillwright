import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export interface AnnouncementsSearch {
  page: number;
  q?: string;
  type?: 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';
  published?: boolean;
}

/**
 * Search state lives in the URL, matching `courses.tsx`'s reasoning: a filtered
 * announcement list is the thing a teacher pastes into a message, and if the filter
 * were React state instead the link they send would open unfiltered.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/announcements',
  validateSearch: (search: Record<string, unknown>): AnnouncementsSearch => {
    const page = Number(search.page);
    return {
      page: Number.isInteger(page) && page > 0 ? page : 1,
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
      ...(search.type === 'NEWS' || search.type === 'EVENT' || search.type === 'ANNOUNCEMENT'
        ? { type: search.type }
        : {}),
      ...(search.published === 'true' || search.published === true
        ? { published: true }
        : search.published === 'false' || search.published === false
          ? { published: false }
          : {}),
    };
  },
  head: () => ({ meta: [{ title: `Announcements · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/Announcements'), 'AnnouncementsPage'),
});
