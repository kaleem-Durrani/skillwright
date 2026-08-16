import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated, type Subject } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  idParamSchema,
  listUsersQuerySchema,
  suspendUserSchema,
  updateUserSchema,
  userDetailSchema,
} from './users.schema.js';
import * as userService from './users.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:106-108), not the
 * type-provider-narrowed one, so `request.params` is `unknown` there. The one cast in
 * this module lives here and never in a handler.
 */
function idOf(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

/**
 * The subject for the two `/me` routes: the caller IS the target.
 *
 * Written as a conditional rather than `{ userId: request.actor?.id }` because
 * exactOptionalPropertyTypes rejects `string | undefined` against
 * `Subject.userId?: string` (actor.ts:53-56) — the enrollments.service.ts:133 /
 * courses.service.ts:133 spelling. Returning `undefined` for an anonymous caller is
 * also the correct policy input: `isSelf` denies on an absent `userId`
 * (combinators.ts:46-49), and `authorize` turns that into 401 rather than 403
 * (auth.plugin.ts:121).
 */
function selfSubject(request: FastifyRequest): Subject | undefined {
  return request.actor ? { userId: request.actor.id } : undefined;
}

/**
 * The subject for the two `/:id` routes: the TARGET, not the caller.
 *
 * This is the whole point of policy.ts:299-303 — `user:read` "stays self-only so that
 * a teacher cannot enumerate the directory one id at a time" — and of policy.ts:312-318,
 * where `not(isSelf)` stops an admin suspending themself and locking the last admin out
 * of the instance. Putting the ACTOR's id here instead would silently invert both.
 *
 * No database read: every `user:*` rule reads `userId` and nothing else, so a loader
 * would spend a query on columns no rule consults (the departments.routes.ts:15-29
 * argument), and returning `undefined` for a missing row would answer an admin with 403
 * where `notFound('User')` is the truthful 404.
 */
function targetSubject(request: FastifyRequest): Subject {
  return { userId: idOf(request) };
}

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * A BARE `authorize('user:list')`, with no subject loader, is a COMPLETE gate here:
   * policy.ts:319-324 is anonymous deny / STUDENT deny / TEACHER deny / ADMIN allow, and
   * every cell is a terminal rule that reads no Subject field. That is the
   * departments.routes.ts:15-29 argument, and it is why this list needs neither the
   * `visibilityWhere` clause `GET /enrollments` grew nor a `requireActor` in the handler
   * — `authorize` has already thrown `unauthenticated()` for a null actor by the time
   * the handler runs, and the service never reads the caller.
   *
   * `user:list` is absent from DEMO_DENIED (can.ts:24-31), so a demo admin still sees
   * the directory; only the destructive `user:suspend` below is closed to them.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: listUsersQuerySchema,
        response: { 200: paginated(userDetailSchema) },
      },
      preHandler: authorize('user:list'),
    },
    async (request) => userService.list(request.query),
  );

  /*
   * '/me' is declared before '/:id' for the reader only. Fastify's find-my-way
   * prioritises a static segment over a parametric one regardless of declaration
   * order, so 'me' can never be parsed as an id — which matters because `idSchema`
   * (common.ts:20-22) would 422 it, and a 422 where a 200 belongs is the exact
   * validation-order trap this repository keeps hitting.
   */
  app.get(
    '/me',
    {
      schema: { response: { 200: userDetailSchema } },
      preHandler: authorize('user:read', selfSubject),
    },
    async (request) => userService.getSelf(requireActor(request)),
  );

  /*
   * `updateUserSchema` is bound UNCHANGED, and that is a decision about a live SPA bug
   * rather than an omission. Settings.tsx:84 seeds react-hook-form with
   * `{ phoneNumber: '', bio: '' }`, so an untouched form PATCHes `phoneNumber: ''`;
   * `updateUserSchema.phoneNumber` is `phoneSchema.nullable()` and phoneSchema
   * (common.ts:60-63) requires /^\+?[0-9\s()-]{7,20}$/, so the empty string is a 422
   * raised by the validator BEFORE this route's policy preHandler runs. Loosening the
   * shared schema to accept '' would make every other client's empty phone number a
   * stored empty string. The SPA must send `undefined` or `null` instead.
   *
   * The body is NOT `.nullish()` here: this PATCH always carries one (Settings.tsx:88),
   * and `updateUserSchema` already refuses `{}` through its own refinement.
   */
  app.patch(
    '/me',
    {
      schema: { body: updateUserSchema, response: { 200: userDetailSchema } },
      preHandler: authorize('user:update', selfSubject),
    },
    async (request) => userService.updateSelf(requireActor(request), request.body),
  );

  // policy.ts:297-305 — STUDENT and TEACHER are `isSelf`, ADMIN is `allow`. The subject
  // is the target, so a teacher asking for someone else's id is 403 (never 404, which
  // would confirm the account exists) and 200 only for their own.
  app.get(
    '/:id',
    {
      schema: { params: idParamSchema, response: { 200: userDetailSchema } },
      preHandler: authorize('user:read', targetSubject),
    },
    async (request) => userService.getById(request.params.id),
  );

  /*
   * `suspendUserSchema.nullish()`, NOT `.optional()`.
   *
   * The SPA sends no body at all — `api.post<void>(`/users/${id}/suspend`)`,
   * AdminUsers.tsx:67 — and Fastify hands a bodyless POST to the validator as `null`,
   * which `.optional()` rejects. Binding `suspendUserSchema` directly (its `reason` is
   * mandatory, user.ts:124-126) would answer the SPA's own call with 422 BEFORE the
   * policy preHandler ever ran: precisely the defect the last batch shipped. The
   * handler therefore passes `request.body ?? undefined` — the courses.routes.ts:154-176
   * pattern — and the service supplies the default reason.
   *
   * `user:suspend` IS in DEMO_DENIED (can.ts:24-31), so a demo admin is refused here
   * with rule `provenance:DEMO` before the role rule is consulted.
   */
  app.post(
    '/:id/suspend',
    {
      schema: {
        params: idParamSchema,
        body: suspendUserSchema.nullish(),
        response: { 200: userDetailSchema },
      },
      preHandler: authorize('user:suspend', targetSubject),
    },
    async (request) => userService.suspend(request.params.id, request.body ?? undefined),
  );

  /*
   * NOT BUILT, deliberately:
   *
   *   POST /users            — `createUserSchema` exists (user.ts:84) but there is no
   *                            `user:create` in the Action union (policy.ts:26-82) and
   *                            the SPA never calls it. Building it would mean inventing
   *                            an action, which costs matrix rows in
   *                            apps/api/test/policy-matrix.test.ts including the
   *                            denials, plus `pnpm docs:permissions` and a regenerated
   *                            docs/permissions.md (CONTRIBUTING.md:40-46).
   *   POST /users/:id/reinstate — `reinstateUserSchema` exists (user.ts:129), there is no
   *                            `user:reinstate` action, and the SPA never calls it. If it
   *                            is ever needed, `user:suspend` is the closest existing
   *                            gate: identical ADMIN-only cell (policy.ts:312-318) and
   *                            `not(isSelf)` is harmless there, since an admin cannot be
   *                            suspended and reinstating oneself is not a thing a
   *                            suspended session can reach anyway.
   */
};

export default usersRoutes;
