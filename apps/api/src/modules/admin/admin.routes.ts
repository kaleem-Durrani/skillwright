import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authorize } from '../../plugins/auth.plugin.js';
import { adminStatsSchema } from './admin.schema.js';
import * as adminService from './admin.service.js';

/**
 * No `idOf(request)` cast at the top of this module, and its absence is not a
 * deviation: the one route takes no params, no querystring and no body, so there is
 * nothing for a `SubjectLoader` to read off the bare `FastifyRequest`
 * (auth.plugin.ts:106-108) and nothing to cast.
 *
 * No `requireActor` in the handler either. `authorize()` has already thrown
 * `unauthenticated()` for a null actor by the time the handler runs
 * (auth.plugin.ts:121), and the service takes no `Actor` — the counters are
 * instance-wide and identical for every caller who passes the gate. This is the
 * departments.routes.ts:15-29 shape, for the departments.routes.ts reason.
 */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * `authorize('user:list')` IS A STAND-IN. There is no `admin:*` entry in the `Action`
   * union (policy.ts:26-82) at all, and inventing one here is not this change's to make.
   *
   * Why this stand-in is correct rather than a near-miss:
   *
   *   - `user:list` (policy.ts:319-324) is anonymous deny / STUDENT deny / TEACHER deny
   *     / ADMIN allow. EVERY cell is a terminal `allow` or `deny` that reads no Subject
   *     field, so a BARE `authorize()` with no subject loader is a COMPLETE gate — the
   *     same argument departments.routes.ts:15-29 makes for its whole module. This is
   *     precisely what the four `dashboard` counters could NOT do: a rule that reads an
   *     absent field must deny (actor.ts:46-51), which is why that endpoint had to fall
   *     back to authentication plus WHERE clauses. Nothing here reads a Subject, so
   *     nothing here is at risk of that failure.
   *   - It denies exactly the set an `admin:read` action would deny. There is no caller
   *     who should see these tiles and is refused, and none who should not and is
   *     admitted.
   *   - The name is not a lie about what is read: three of the four counters
   *     (`users`, `suspendedUsers`, `departments`) are the user and department tables.
   *     `audit:read` (policy.ts:452-457) has the identical role cells and would also
   *     work; it is the weaker fit because only ONE of the four counters touches
   *     AuditEvent.
   *   - It is absent from DEMO_DENIED (can.ts:24-31), so a demo admin still sees the
   *     tiles — which matches "everything non-destructive stays open so the demo is
   *     worth logging into" (can.ts:22). Reading four counts destroys nothing.
   *
   * IF an `admin:read` action is ever added — anonymous / STUDENT / TEACHER deny,
   * ADMIN allow — it replaces the action below and this comment goes with it. That is
   * not a one-line edit: CONTRIBUTING.md:40-46 requires the action in
   * packages/shared/src/policy/, its rows INCLUDING THE DENIALS in
   * packages/shared/test/policy-matrix.test.ts, and a regenerated docs/permissions.md
   * from `pnpm docs:permissions` (package.json:30), which CI runs with `--check` and
   * fails on when stale (scripts/generate-permissions-doc.ts:13). It is the repository
   * owner's separate change, not this module's.
   *
   * Suspended, unverified and MFA_PENDING sessions are refused before this preHandler
   * ever runs, by the onRequest hook in auth.plugin.ts:63-83. Nothing is re-checked here.
   */
  app.get(
    '/stats',
    {
      schema: { response: { 200: adminStatsSchema } },
      preHandler: authorize('user:list'),
    },
    async () => adminService.stats(),
  );
};

export default adminRoutes;
