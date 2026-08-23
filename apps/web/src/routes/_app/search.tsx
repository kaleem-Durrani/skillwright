import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { Route as appLayout } from '../_app.js';

export interface SearchSearch {
  /**
   * The term exactly as typed — the server trims (`searchQuerySchema`) and this
   * page guards its request on a trimmed copy, but the URL keeps the user's
   * keystrokes so back/forward restores what they see.
   *
   * No `page`: the cross-entity endpoint is capped per group (limit 5), not
   * paginated — "nobody pages a combined search" is the API's own stated
   * contract — and each section's overflow links to the entity's real filtered
   * list instead.
   */
  q?: string;
}

/**
 * Search state lives in the URL, matching `courses.tsx`'s reasoning: a query is
 * the thing a user bookmarks or pastes into a message, and if it lived in React
 * state the link they send would open an empty search.
 */
export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/search',
  validateSearch: (search: Record<string, unknown>): SearchSearch => {
    return {
      ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
    };
  },
  head: () => ({ meta: [{ title: `Search · ${BRAND.name}` }] }),
  component: lazyRouteComponent(() => import('@/pages/SearchResults'), 'SearchResultsPage'),
});
