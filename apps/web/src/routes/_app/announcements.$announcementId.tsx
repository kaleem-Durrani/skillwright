import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { BRAND } from '@skillwright/shared/brand';
import { qk } from '@/lib/query';
import { api } from '@/lib/api';
import { Route as appLayout } from '../_app.js';

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/announcements/$announcementId',
  // Warm the cache during the navigation rather than after it, so the screen
  // mounts with data instead of mounting a skeleton and then swapping.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: qk.announcement(params.announcementId),
      queryFn: () => api.get(`/announcements/${params.announcementId}`),
    }),
  head: () => ({ meta: [{ title: `Announcement · ${BRAND.name}` }] }),
  component: lazyRouteComponent(
    () => import('@/pages/AnnouncementDetail'),
    'AnnouncementDetailPage',
  ),
});
