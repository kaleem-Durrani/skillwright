import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { paginated, type Subject } from '@skillwright/shared';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  accountDeletionSchema,
  accountDeletionStatusSchema,
  bulkImportSchema,
  bulkImportResultSchema,
  createUserSchema,
  idParamSchema,
  listUsersQuerySchema,
  reinstateUserSchema,
  suspendUserSchema,
  updateUserSchema,
  userDetailSchema,
  userExportSchema,
} from './users.schema.js';
import * as lifecycle from './users.lifecycle.service.js';
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
 * `Subject.userId?: string` (actor.ts:53-56) — the `loadRequestedCourseSubject` spelling
 * in enrollments.service.ts. Returning `undefined` for an anonymous caller is
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
 * This is the whole point of `POLICY`'s `user:read` — "stays self-only so that
 * a teacher cannot enumerate the directory one id at a time" — and of `user:suspend`,
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
   * `user:list` in `POLICY` is anonymous deny / STUDENT deny / TEACHER deny / ADMIN allow, and
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
   * Provisioning, Phase 4b. `user:create` is subject-free (`POLICY` — every
   * cell is a terminal allow/deny decided by role alone, before any target exists to
   * load a subject for), so a BARE `authorize()` is a complete gate here, exactly as
   * for `user:list` above and for every departments route.
   *
   * `createUserSchema` is bound VERBATIM — its superRefine already makes departmentId
   * mandatory for teachers and students and qualification mandatory for teachers, so
   * the wire refuses those before this handler runs and the service only restates the
   * narrowing it needs for exactOptionalPropertyTypes.
   */
  app.post(
    '/',
    {
      schema: { body: createUserSchema, response: { 201: userDetailSchema } },
      preHandler: authorize('user:create'),
    },
    async (request, reply) => reply.status(201).send(await userService.create(request.body)),
  );

  /*
   * The cohort import, `POST /users/bulk` (Phase 4).
   *
   * DECLARED BEFORE `/:id` and the same static-segment argument as `/me` above
   * applies: find-my-way ranks a static segment above a parametric one, so `/bulk`
   * is never parsed as an id and `idParamSchema` never gets a chance to 422 it.
   *
   * ITS OWN RATE-LIMIT BUCKET, which is the brief's "rate-limited separately from
   * the rest of `/users`" and is a separate `config.rateLimit` rather than a
   * `preHandler`. The distinction is not cosmetic: the global bucket is
   * 300/minute per IP over the WHOLE API (ratelimit.plugin.ts), and a hundred-row
   * import arriving every thirty seconds would spend a third of the entire
   * instance's request budget on one admin's afternoon. Ten per hour keyed on the
   * ACTING ADMIN rather than the address is the right shape for the operation — a
   * school imports a cohort a handful of times a year, and an admin behind a shared
   * NAT should not spend the school's budget.
   *
   * `keyGenerator` is what makes it per-admin: the global one is `request.ip`, so
   * every teacher in a college sharing one NAT would share this bucket too. The
   * unauthenticated case (an anonymous caller) has no actor and falls back to the
   * IP, which is the right answer for a request that is about to be refused anyway.
   *
   * AND ITS OWN ACTION, `user:bulk-create`, rather than reusing `user:create` —
   * see policy.ts for why the two are deliberately distinct cells.
   */
  app.post(
    '/bulk',
    {
      // Size cap is the schema's `BULK_IMPORT_MAX_ROWS`; this is the second, and
      // the byte-level, one. A hundred rows of a createUser body is well under
      // Fastify's 1 MiB default, so the row cap binds first and this is the
      // backstop for a caller who sends a thousand rows of something else entirely.
      bodyLimit: 512 * 1024,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 60 * 60 * 1000,
          /*
           * `groupId`, not `nameSpace`. A route-level `config.rateLimit` is merged
           * onto the GLOBAL plugin registration, and `nameSpace` is a
           * plugin-registration option only — the per-route type does not have it.
           * `groupId` is the documented mechanism for exactly this: it is appended
           * to the computed key, so `rl:global:<actorId>users-bulk` is a different
           * Redis key from the global `rl:global:<ip>`, and the two counters cannot
           * see each other. That is what "separately rate-limited" has to mean — a
           * shared counter is the same counter with a different label on it.
           */
          groupId: 'users-bulk',
          /*
           * Keyed on the ACTING ADMIN, not the address. The global generator is
           * `request.ip`, so every teacher in a college behind one NAT would share
           * this bucket and one admin's import would 429 a colleague mid-session.
           * The anonymous fallback is the IP, which is the right key for a request
           * that `authorize` is about to refuse anyway.
           */
          keyGenerator: (request: FastifyRequest) => request.actor?.id ?? request.ip,
        },
      },
      schema: { body: bulkImportSchema, response: { 200: bulkImportResultSchema } },
      preHandler: authorize('user:bulk-create'),
    },
    async (request) => userService.bulkImport(request.body),
  );

  /*
   * `GET /users/me/export` — a data-subject access request, satisfied by the API
   * rather than by a hand-written database query.
   *
   * 200, not 201 or 202: nothing was created and nothing is pending, and a status
   * that implies otherwise would be a small lie in a document somebody is about to
   * hand to a regulator. A GET with no side effects is also why this needs no
   * CSRF token beyond the same-origin check every GET here runs.
   *
   * The subject is the caller, so `user:export` is `isSelf` for all three roles and
   * the route takes no id — there is no `/:id/export`, and adding one would be an
   * export of a third party, which policy.ts says in as many words.
   */
  app.get(
    '/me/export',
    {
      schema: { response: { 200: userExportSchema } },
      preHandler: authorize('user:export', selfSubject),
    },
    async (request) => lifecycle.exportMine(requireActor(request).id),
  );

  /*
   * `GET /users/me/deletion` — the caller's own pending deletion, so the SPA can
   * render the deadline and offer the cancel without a second write. Read-only, so
   * it needs no `confirmEmail`.
   */
  app.get(
    '/me/deletion',
    {
      schema: { response: { 200: accountDeletionStatusSchema } },
      preHandler: authorize('user:delete', selfSubject),
    },
    async (request) => lifecycle.deletionStatus(requireActor(request).id),
  );

  /*
   * `POST /users/me/deletion` — schedule the caller's own deletion.
   *
   * 202, not 200, and the distinction is the feature. The account is NOT deleted:
   * the response is a schedule with a deadline in it, and `cancellation is still
   * possible` is exactly what 202 means. A 200 here would tell the caller — and any
   * script reading it — that the thing was done, and the person would then discover
   * a month later that the undo they were told about had a deadline they never saw.
   *
   * The body is NOT `.nullish()`, unlike the two bodyless POSTs on this router.
   * That is deliberate and it is the opposite rule: a bodyless DELETE REQUEST
   * confirms nothing, and the confirm-by-typing is a real control whose server
   * half is the `confirmEmail` comparison in the service. Binding it `.nullish()`
   * would let `POST /users/me/deletion` with no body at all schedule a thirty-day
   * clock, which is the one outcome nobody asked for.
   */
  app.post(
    '/me/deletion',
    {
      schema: { body: accountDeletionSchema, response: { 202: accountDeletionStatusSchema } },
      preHandler: authorize('user:delete', selfSubject),
    },
    async (request, reply) => {
      const actor = requireActor(request);
      return reply
        .status(202)
        .send(await lifecycle.requestDeletion(actor.id, request.body.confirmEmail));
    },
  );

  /*
   * `DELETE /users/me/deletion` — the undo, inside the cool-off. No body: cancelling
   * needs no confirmation, because the failure mode of a spurious cancel is that
   * somebody's account stays alive, which is the recoverable direction.
   */
  app.delete(
    '/me/deletion',
    {
      schema: { response: { 200: accountDeletionStatusSchema } },
      preHandler: authorize('user:delete', selfSubject),
    },
    async (request) => lifecycle.cancelDeletion(requireActor(request).id),
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
   * `updateUserSchema` is bound exactly as shared defines it — Phase 4b added its
   * profile fields additively, and role/status remain absent BY DESIGN. What follows
   * is a decision about a live SPA bug rather than an omission. Settings.tsx:84 seeds
   * react-hook-form with
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

  // `POLICY`'s `user:read` — STUDENT and TEACHER are `isSelf`, ADMIN is `allow`. The subject
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
   * The admin half of `user:update` (Phase 4b): the SAME action and the SAME
   * `updateUserSchema` body as `/me` above, with the subject pointed at the TARGET.
   * The role cells do all the gating — a teacher or student addressing another id is
   * refused by `isSelf` before any handler code runs — so this route adds no second
   * check of its own. Profile fields in the body are judged against the TARGET's role
   * inside the service (`rejectMismatchedProfileFields(target.role, ...)`), which is
   * what stops an admin writing a staffNo onto a student account; `avatarUploadId` is
   * refused outright there because an upload belongs to its owner.
   */
  app.patch(
    '/:id',
    {
      schema: {
        params: idParamSchema,
        body: updateUserSchema,
        response: { 200: userDetailSchema },
      },
      preHandler: authorize('user:update', targetSubject),
    },
    async (request) => userService.update(request.params.id, request.body),
  );

  /*
   * `suspendUserSchema.nullish()`, NOT `.optional()`.
   *
   * The SPA sends no body at all — `api.post<void>(`/users/${id}/suspend`)`,
   * AdminUsers.tsx:67 — and Fastify hands a bodyless POST to the validator as `null`,
   * which `.optional()` rejects. Binding `suspendUserSchema` directly (its `reason` is
   * mandatory, user.ts:142-144) would answer the SPA's own call with 422 BEFORE the
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
   * The undo of `/:id/suspend` above, gated on `user:reinstate` — a subject-free action
   * (policy.ts) whose every cell is a terminal allow/deny, so the SAME bare-gate
   * argument as `user:suspend` applies: `targetSubject` is still passed because it is
   * free (no loader query reads it) and keeps this route shaped like its twin.
   *
   * Body handling mirrors suspend exactly: the SPA posts no body at all, Fastify hands
   * a bodyless POST to the validator as `null`, so `.nullish()` + `?? undefined` is
   * what keeps this route's own call from 422ing before the policy preHandler ran.
   * `reinstateUserSchema.note` is optional (user.ts), so an absent body reaches the
   * service as no note at all.
   */
  app.post(
    '/:id/reinstate',
    {
      schema: {
        params: idParamSchema,
        body: reinstateUserSchema.nullish(),
        response: { 200: userDetailSchema },
      },
      preHandler: authorize('user:reinstate', targetSubject),
    },
    async (request) => userService.reinstate(request.params.id, request.body ?? undefined),
  );
};

export default usersRoutes;
