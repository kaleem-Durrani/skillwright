import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { qk } from '@/lib/query';
import { api } from '@/lib/api';
import { Route as appLayout } from '../_app.js';

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/resources/$resourceId',
  // Warm the cache during the navigation rather than after it, so the screen
  // mounts with data instead of mounting a skeleton and then swapping.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: qk.resource(params.resourceId),
      queryFn: () => api.get(`/resources/${params.resourceId}`),
    }),
  component: lazyRouteComponent(() => import('@/pages/ResourceDetail'), 'ResourceDetailPage'),
});
