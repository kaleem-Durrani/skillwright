import { Route as rootRoute } from './__root.js';
import { Route as publicLayout } from './_public.js';
import { Route as publicIndex } from './_public/index.js';
import { Route as loginRoute } from './_public/login.js';
import { Route as registerRoute } from './_public/register.js';
import { Route as verifyEmailRoute } from './_public/verify-email.js';
import { Route as forgotPasswordRoute } from './_public/forgot-password.js';
import { Route as resetPasswordRoute } from './_public/reset-password.js';
import { Route as appLayout } from './_app.js';
import { Route as dashboardRoute } from './_app/dashboard.js';
import { Route as coursesRoute } from './_app/courses.js';
import { Route as courseDetailRoute } from './_app/courses.$courseId.js';
import { Route as messagesRoute } from './_app/messages.js';
import { Route as settingsRoute } from './_app/settings.js';
import { Route as adminLayout } from './_app/admin.js';
import { Route as adminIndexRoute } from './_app/admin.index.js';
import { Route as adminUsersRoute } from './_app/admin.users.js';
import { Route as designRoute } from './_design.js';

/**
 * The route tree, assembled by hand from the files above.
 *
 * WHY hand-assembled rather than generated: the generator writes ONE
 * routeTree.gen.ts that statically imports every route module. That file then
 * imports every screen, and the bundler — correctly — concludes that everything
 * is reachable from the entry chunk. Every route definition here is a few lines
 * of metadata; the screens themselves arrive only through the
 * `lazyRouteComponent(() => import('@/pages/…'))` calls, which are the real
 * split points. This is exactly the mistake the previous app shipped.
 */
export const routeTree = rootRoute.addChildren([
  publicLayout.addChildren([
    publicIndex,
    loginRoute,
    registerRoute,
    verifyEmailRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
  ]),
  appLayout.addChildren([
    dashboardRoute,
    coursesRoute,
    courseDetailRoute,
    messagesRoute,
    settingsRoute,
    adminLayout.addChildren([adminIndexRoute, adminUsersRoute]),
  ]),
  designRoute,
]);
