import { prisma, type Prisma } from '@skillwright/db';
import type { Actor } from '@skillwright/shared';
// The resources tile counts what the resources LIST serves, so it asks that module
// for the clause rather than keeping a second copy — see the block above
// `stats()`'s resource count for what the second copy cost.
import { visibilityWhere as visibleResourcesWhere } from '../resources/resources.service.js';
import type { DashboardStats } from './dashboard.schema.js';

/**
 * The row a `COUNT(*)::int` comes back as. Declared rather than inlined so the `::int`
 * in the SQL and the `number` here are visibly the same decision: without the cast
 * Postgres returns `bigint`, node-postgres hands it to Prisma as a JS BigInt, and
 * `dashboardStatsSchema`'s `z.number()` rejects it — a response-validation 500 on a
 * read-only endpoint, which is the least debuggable failure this module could ship.
 */
interface CountRow {
  count: number;
}

// ---------------------------------------------------------------------------
// The four visibility clauses — this module's policy, written as WHERE
// ---------------------------------------------------------------------------

/*
 * Why there are four of these and not one `visibilityWhere`:
 *
 * `GET /dashboard/stats` aggregates across four models, so it mirrors four separate
 * policy row sets. Each clause below is a `visibilityWhere` in the sense
 * `visibilityWhere` in enrollments.service.ts established — one named function, one policy
 * row set,
 * cited row by row, and the same standing rule: if the function and policy.ts ever
 * disagree, the FUNCTION is the bug. Folding four unrelated models into one function
 * named `visibilityWhere` would give four rules one home and hide which row each
 * branch mirrors.
 *
 * There is no `dashboard:*` action to ask `can()` (see dashboard.routes.ts), so these
 * clauses ARE the authorization for this endpoint. Reading `actor.role` here is
 * choosing which WHERE mirrors which policy row — the one legitimate role read named
 * by CONTRIBUTING.md:48-55 — not a permission check.
 */

/**
 * Counter 1, `courses`. The "Courses" tile that sits directly above the "Your courses"
 * section (Dashboard.tsx:53), so it counts the actor's OWN courses, not the catalogue.
 *
 * It is `course:read` (`POLICY`), mirrored by courses.service.ts:169-184, and
 * then NARROWED to ownership:
 *   ADMIN   -> allow                             -> every live course
 *   TEACHER -> or(isPublished, ownsCourse)       -> narrowed to `teacherId = actor.id`
 *   STUDENT -> or(isPublished, enrolledApproved) -> narrowed to `enrolledApproved`
 *
 * The narrowing is deliberate and is only ever a SUBSET of what `course:read` permits,
 * so it cannot leak: a teacher whose tile counted the published catalogue would read
 * "412 courses" above a list of their own three. If the two ever disagree, this
 * function is the bug.
 *
 * Soft delete is not enforced by the ORM (`deletedAt` is a plain nullable column, the
 * schema.prisma header's rule 3), so `deletedAt` is
 * filtered by hand in every branch, exactly like every other read in the codebase.
 */
function ownCoursesWhere(actor: Actor): Prisma.CourseWhereInput {
  switch (actor.role) {
    case 'ADMIN':
      return { deletedAt: null };
    case 'TEACHER':
      return { deletedAt: null, teacherId: actor.id };
    case 'STUDENT':
      // The same `enrolledApproved` shape courses.service.ts uses; a PENDING
      // application is not a course you have. Seats are per-intake since Phase 9,
      // so the relation is two hops — any live offering of the course counts.
      return {
        deletedAt: null,
        offerings: {
          some: {
            deletedAt: null,
            enrollments: { some: { studentId: actor.id, status: 'APPROVED' } },
          },
        },
      };
  }
}

/**
 * Counter 2, `pendingEnrollments` (Dashboard.tsx:57).
 *
 * `enrollment:read` (`POLICY`), the same rows `visibilityWhere` in
 * enrollments.service.ts mirrors, with `status: 'PENDING'` on top:
 *   STUDENT -> isEnrolledStudent -> `studentId = actor.id`
 *   TEACHER -> ownsCourse        -> `course.teacherId = actor.id`
 *   ADMIN   -> allow             -> unrestricted
 *
 * The tile must count exactly the rows the queue beneath it lists — Dashboard.tsx:40-48
 * calls `/enrollments?status=PENDING`, which is `enrollments.service.ts:list`. A tile
 * that says 7 above a list of 3 is a bug report, so this clause and that one are the
 * same clause plus a status filter. If they disagree, this function is the bug.
 *
 * The course's soft-delete filter is written by hand here too: an enrollment on a
 * deleted course is invisible in the queue (`visibilityWhere` in enrollments.service.ts) and must
 * therefore be invisible in the tile.
 */
function pendingEnrollmentsWhere(actor: Actor): Prisma.EnrollmentWhereInput {
  const scope: Prisma.EnrollmentWhereInput =
    actor.role === 'STUDENT'
      ? { studentId: actor.id }
      : actor.role === 'TEACHER'
        ? // The course rides the offering relation since Phase 9.
          { offering: { course: { teacherId: actor.id } } }
        : {};

  // Soft delete is filtered by hand on BOTH levels: an enrollment on a retired intake
  // or a deleted course is invisible in the queue (enrollments.service.ts's
  // visibilityWhere) and must therefore be invisible in the tile.
  return {
    AND: [
      scope,
      { status: 'PENDING' },
      { offering: { deletedAt: null, course: { deletedAt: null } } },
    ],
  };
}

/*
 * Counter 4, `resources` (Dashboard.tsx:66), has NO clause of its own.
 *
 * It used to. The comment that stood here instructed whoever built the resources
 * module to move the mirror into `resources.service.ts` and import it back —
 * "do not leave a second copy behind, or a policy change fixes the list and
 * silently misses the tile". The module landed with a second copy, and the two had
 * already drifted before anyone ran them side by side: this one filtered only the
 * resource's own `deletedAt`, while the list also excludes resources whose COURSE is
 * soft-deleted. So the tile counted rows no list would ever return, which is the
 * "tile reads 23 above a list of 4" failure the other three counters are written to
 * avoid.
 *
 * `visibilityWhere` (resources.service.ts) is now the only mirror of the
 * `resource:read` rows, and it is imported at the top of this file.
 */

/**
 * Counter 3, `unreadMessages` (Dashboard.tsx:63).
 *
 * Raw SQL because the Prisma query API cannot express it: the predicate compares a
 * Message COLUMN to a ConversationParticipant COLUMN per row (`m.seq > p.lastReadSeq`),
 * and a field reference cannot cross a relation. The alternative is loading every
 * participant row and counting in JavaScript, which is one query per conversation.
 *
 * Identical for all three roles, so there is no role branch: `conversation:read` is
 * `isParticipant` for STUDENT, TEACHER and ADMIN alike (`POLICY` — "Admins
 * moderate threads they were seated in; the schema can seat them, so there is no need
 * for a bypass"). The actor's own seat, `p."userId" = ${actor.id}` with `leftAt IS
 * NULL`, IS the whole scope. If that row rule and this WHERE ever disagree, this
 * query is the bug.
 *
 * A tagged template, never `$executeRawUnsafe`, and `actor.id` is a bound parameter
 * rather than interpolated text — the tagged `$executeRaw` in `approve`
 * (enrollments.service.ts) is the precedent.
 *
 * `::int` is load-bearing: Postgres `COUNT(*)` is `bigint`, and without the cast the
 * value arrives as a JS BigInt that `z.number()` rejects and `JSON.stringify` throws on.
 *
 * `m."deletedAt" IS NULL` because Message carries a soft-delete column (schema.prisma:
 * 584) the ORM does not enforce; `m."senderId" <> ${actor.id}` because your own message
 * is not news, and the sender's `lastReadSeq` only advances when they next read the
 * thread — without this clause every message you send increments your own badge.
 *
 * Returned rather than awaited so the caller can batch it with the three counts.
 */
function unreadMessagesQuery(actor: Actor): Prisma.PrismaPromise<CountRow[]> {
  return prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::int AS count
      FROM "Message" m
      JOIN "ConversationParticipant" p ON p."conversationId" = m."conversationId"
     WHERE p."userId" = ${actor.id}
       AND p."leftAt" IS NULL
       AND m."seq" > p."lastReadSeq"
       AND m."deletedAt" IS NULL
       AND m."senderId" <> ${actor.id}`;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * One round trip for four tiles.
 *
 * The four reads go out as a single `$transaction([...])` array, the same shape the
 * list endpoints use for their rows-plus-total pair (courses.service.ts:252-260). It
 * also makes the four numbers a consistent snapshot rather than four reads spread
 * across an approval landing between them.
 *
 * TRAP 3 does NOT apply: this is read-only and touches no model in `AUDITED_MODELS`
 * (packages/db/src/audit.ts), so nothing here makes the audit extension reach for its
 * second pool while this transaction holds a connection, and the default budget is
 * correct. The generous
 * `TX_OPTIONS` in enrollments.service.ts belongs to interactive transactions that
 * MUTATE an audited model; borrowing it here would be cargo cult.
 *
 * Takes an `Actor`, never a FastifyRequest.
 */
export async function stats(actor: Actor): Promise<DashboardStats> {
  const [courses, pendingEnrollments, unread, resources] = await prisma.$transaction([
    prisma.course.count({ where: ownCoursesWhere(actor) }),
    prisma.enrollment.count({ where: pendingEnrollmentsWhere(actor) }),
    unreadMessagesQuery(actor),
    prisma.resource.count({ where: visibleResourcesWhere(actor) }),
  ]);

  return {
    courses,
    pendingEnrollments,
    // An aggregate always returns exactly one row, but `noUncheckedIndexedAccess`
    // types `unread[0]` as possibly undefined and is right to: nothing in the type
    // system knows this SQL has no GROUP BY.
    unreadMessages: unread[0]?.count ?? 0,
    resources,
  };
}
