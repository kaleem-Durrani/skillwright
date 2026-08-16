import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { qk } from '@/lib/query';
import { api } from '@/lib/api';
import { Route as appLayout } from '../_app.js';

export const Route = createRoute({
  getParentRoute: () => appLayout,
  path: '/courses/$courseId',
  // Warm the cache during the navigation rather than after it, so the screen
  // mounts with data instead of mounting a skeleton and then swapping.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: qk.course(params.courseId),
      queryFn: () => api.get(`/courses/${params.courseId}`),
    }),
  component: lazyRouteComponent(() => import('@/pages/CourseDetail'), 'CourseDetailPage'),
});
