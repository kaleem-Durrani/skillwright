import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated, type Subject } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  notificationSchema,
  unreadCountResponseSchema,
} from './notifications.schema.js';
import * as notificationService from './notifications.service.js';

/**
 * The subject every route in this module passes, and the reason it is a function
 * rather than an inline object literal at each `authorize()` call.
 *
 * policy.ts:458-470 makes `notification:read` and `notification:update` `isSelf` for
 * all three roles, and policy.ts:460 writes the contract into the policy table itself:
 * "Notification rows are per-user; list endpoints pass `{ userId: actor.id }`".
 *
 * The conditional return is required, not stylistic. Under `exactOptionalPropertyTypes`
 * the obvious `{ userId: request.actor?.id }` does NOT type-check against
 * `Subject.userId?: string`, because `string | undefined` is not assignable to an
 * optional `string` (enrollments.service.ts:133 and courses.service.ts:133 spread a
 * conditional for the same reason).
 *
 * Returning `undefined` for an anonymous caller is safe: `can()` evaluates the
 * anonymous rule and returns before it ever reads the subject (can.ts:56-63), and
 * `authorize()` then throws 401 rather than 403 (auth.plugin.ts:121).
 *
 * There is no `idOf`-style cast in this module — the one that courses.routes.ts:25-36
 * and enrollments.routes.ts:16-27 need — because no route here takes a path param.
 * A `SubjectLoader` still receives the BARE FastifyRequest (auth.plugin.ts:106-108),
 * but this loader reads only `request.actor`, which is typed on every request by the
 * auth plugin's decorator.
 */
function selfSubject(request: FastifyRequest): Subject | undefined {
  return request.actor ? { userId: request.actor.id } : undefined;
}

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * Declared before `GET /` only for readability; Fastify's radix router matches the
   * static segment regardless of registration order, so `/unread-count` can never be
   * shadowed. There is no `/:id` route in this module to shadow it with anyway.
   */
  app.get(
    '/unread-count',
    {
      schema: { response: { 200: unreadCountResponseSchema } },
      preHandler: authorize('notification:read', selfSubject),
    },
    async (request) => notificationService.unreadCount(requireActor(request)),
  );

  /*
   * Unlike `GET /enrollments` (enrollments.routes.ts:32-40) and `GET /courses`, this
   * list DOES go through `authorize()`. The structural reason those two skip it does
   * not apply: every `notification:read` cell is either `deny` or `isSelf`, and the
   * subject `isSelf` needs is the ACTOR's own id, which is available without touching
   * the database. A subject-free gate would deny; a self-subject gate answers exactly.
   *
   * The gate can only answer yes/no, so which ROWS come back is still the service's
   * `scopedWhere`. `requireActor` here is not an auth check — `authorize()` has already
   * thrown 401 for a null actor by the time this handler runs (departments.routes.ts:15-29)
   * — it is how the handler obtains the typed `Actor` the service takes.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listNotificationsQuerySchema,
        response: { 200: paginated(notificationSchema) },
      },
      preHandler: authorize('notification:read', selfSubject),
    },
    async (request) => notificationService.list(requireActor(request), request.query),
  );

  /*
   * One bulk verb, no `PATCH /notifications/:id`. notification.ts:49-52 is explicit:
   * "omitting `ids` marks everything. Two endpoints for 'this one' and 'all of them'
   * would be the same transaction written twice."
   *
   * `.nullish()`, NOT `.optional()`: Fastify hands a bodyless POST to the validator as
   * `null`, which `.optional()` rejects — so a bell's "mark all read", which sends no
   * body at all, would answer 422 before the policy preHandler ever ran. That is a real
   * defect this repository already shipped once (courses.routes.ts:154-176).
   *
   * The response is the recomputed unread count rather than 204, so the badge updates
   * from the same round trip.
   */
  app.post(
    '/read',
    {
      schema: {
        body: markNotificationsReadSchema.nullish(),
        response: { 200: unreadCountResponseSchema },
      },
      preHandler: authorize('notification:update', selfSubject),
    },
    async (request) =>
      notificationService.markRead(requireActor(request), request.body ?? undefined),
  );
};

export default notificationsRoutes;
