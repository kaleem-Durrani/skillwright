import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireActor } from '../../plugins/auth.plugin.js';
import { dashboardStatsSchema } from './dashboard.schema.js';
import * as dashboardService from './dashboard.service.js';

/*
 * No `idOf(request)` cast in this module: the one route takes no params, no body and
 * no querystring, so nothing here ever reads an untyped request field. The cast the
 * other modules keep at the top of their routes file (courses.routes.ts:25-36) exists
 * for SubjectLoaders, and this module has none — see below.
 */

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No `authorize()` here, deliberately.
   *
   * No `dashboard:*` action exists; this route is authentication-gated and the policy
   * lives in the four WHERE clauses below, each mirroring the policy.ts rows named
   * beside it. If a `dashboard:read` action is ever added, this comment and those
   * clauses change together.
   *
   *   `courses`            -> `course:read`       policy.ts:118-124  -> ownCoursesWhere
   *   `pendingEnrollments` -> `enrollment:read`   policy.ts:160-165  -> pendingEnrollmentsWhere
   *   `unreadMessages`     -> `conversation:read` policy.ts:397-404  -> unreadMessagesQuery
   *   `resources`          -> `resource:read`     policy.ts:191-196  -> visibleResourcesWhere
   *
   * WHY it cannot go through the gate, which is the same structural reason
   * enrollments.routes.ts:32-40 gives: not one of those four actions can be asked as a
   * subject-free yes/no. Every one of them is Subject-dependent for at least one role
   * — `isPublished`, `enrolledApproved`, `ownsCourse`, `isEnrolledStudent`,
   * `isParticipant`, `isPublic` — and a rule that reads an absent field must deny
   * (actor.ts:46-51). So `authorize(<any of them>)` with an empty subject would 403
   * every legitimate non-admin caller, on the one page the SPA loads for everybody
   * (Dashboard.tsx:26-29 fires this query with no `enabled` guard).
   *
   * Nor is a near-miss action borrowed here. Inventing `dashboard:read` is not this
   * module's change to make: CONTRIBUTING.md:40-46 — a new action needs its rows in
   * the permission matrix INCLUDING the denials (the file is
   * packages/shared/test/policy-matrix.test.ts; CONTRIBUTING.md:43 still names the old
   * apps/api path), plus `pnpm docs:permissions` and the regenerated docs/permissions.md.
   * If it is ever added, the shape that matches this endpoint is anonymous deny /
   * STUDENT allow / TEACHER allow / ADMIN allow — the row scoping already lives in the
   * WHERE clauses, so the gate only ever needs to answer "is there a session".
   *
   * Skipping `authorize()` does NOT skip the session-state gates. MFA_PENDING,
   * SUSPENDED and PENDING_VERIFICATION are enforced centrally by auth.plugin.ts's
   * onRequest hook (:63-83), which runs for every route including the ones that gate on
   * authentication alone — auth.plugin.ts:73-79 names this exact case as the reason the
   * check lives there rather than inside `can()` only.
   *
   * `requireActor` throws unauthenticated() for an anonymous caller (auth.plugin.ts:
   * 96-99), which is what makes authentication a real gate rather than a comment.
   */
  app.get('/stats', { schema: { response: { 200: dashboardStatsSchema } } }, async (request) =>
    dashboardService.stats(requireActor(request)),
  );
};

export default dashboardRoutes;
