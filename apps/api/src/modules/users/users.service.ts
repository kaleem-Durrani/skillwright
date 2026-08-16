import { prisma, type Prisma } from '@skillwright/db';
import { paginationMeta, toSkipTake, type Actor, type Paginated } from '@skillwright/shared';
import { notFound, validationFailed } from '../../lib/errors.js';
import { baseLogger } from '../../lib/logger.js';
/*
 * `toUserDetail` is imported rather than copied. It is the ONLY shape a user is
 * serialised as, and a second copy here would be a second place for `mfaEnabled`, the
 * derived avatar and the two profile projections to disagree — exactly the failure
 * lib/dto.ts:4-14 was created to stop.
 *
 * Its home is wrong, though, and knowingly so: it lives in another MODULE'S service
 * (auth.service.ts:76-109), so importing it drags auth's behaviour into this module,
 * which lib/dto.ts:12-14 explicitly argues against ("holds no queries, no policy and
 * no Actor, so any module may import it without importing another module's
 * behaviour"). TODO(dto): lift `toUserDetail` and auth.service.ts's `PROFILE_INCLUDE`
 * (as `USER_DETAIL_INCLUDE`) into lib/dto.ts the same way `toUserSummary` was lifted,
 * and have BOTH auth.service.ts and this file import them. That edit touches a shared
 * file, so it is not this change's to make.
 */
import { toUserDetail } from '../auth/auth.service.js';
import { destroyAllSessions } from '../auth/session.service.js';
import type {
  ListUsersQuery,
  SuspendUserInput,
  UpdateUserInput,
  UserDetail,
} from './users.schema.js';

const log = baseLogger.child({ module: 'users' });

/**
 * The relations `toUserDetail` reads. There is NO `User.departmentId` column
 * (schema.prisma:128-184) — a person's department hangs off whichever profile they
 * have, so the department name the console renders arrives through two joins and not
 * one field.
 *
 * This is a byte-for-byte copy of auth.service.ts:68-71 on purpose, and it is the
 * INCLUDE and not the mapper: the two produce structurally identical
 * `UserGetPayload`s, so `toUserDetail` still type-checks against rows loaded here, and
 * the TODO(dto) above collapses both constants into one when it lands.
 *
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `UserGetPayload` widens to `boolean` and the mapper stops being checked
 * against the columns it reads.
 */
const USER_DETAIL_INCLUDE = {
  teacherProfile: { include: { department: true } },
  studentProfile: { include: { department: true } },
} as const;

/**
 * user.ts:123 — "Suspension always carries a reason; it lands in the audit row and the
 * email." The SPA posts no body at all (AdminUsers.tsx:67), so the route binds
 * `suspendUserSchema.nullish()` and an absent reason becomes this.
 *
 * The reason has nowhere to be STORED: `User` has no suspension-reason column
 * (schema.prisma:128-184) and the audit row is written by the Prisma extension, which
 * snapshots columns and cannot be handed free text (audit.ts:288-427). Writing an
 * AuditEvent by hand to carry it would double the row the extension already writes.
 * So it is logged, where an operator can still find it, and the honest fix is either a
 * `User.suspensionReason` column or a `metadata` field on AuditEvent — both schema
 * changes with migrations, not something a route module invents.
 */
const DEFAULT_SUSPENSION_REASON = 'Suspended by an administrator';

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/*
 * `toUserDetail` is the module's entity mapper and is imported above. Nothing is
 * re-derived here: `avatarUrl` is `avatarUrlFor(user.id)` (packages/db/src/avatar.ts:13)
 * and `mfaEnabled` is `totpEnabledAt !== null`, both inside that one function.
 */

/**
 * The one read shape, so the soft-delete filter and the include cannot drift apart
 * between `GET /users/:id`, `GET /users/me` and the idempotent branch of `suspend`.
 *
 * `findFirst({ id, deletedAt: null })` and never `findUnique({ id })`: soft delete is
 * not enforced by the ORM, so a deleted account must be filtered out by hand or it
 * reads as present (departments.service.ts:66-71).
 */
async function detailById(id: string): Promise<UserDetail> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: USER_DETAIL_INCLUDE,
  });
  if (!user) throw notFound('User');
  return toUserDetail(user);
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/*
 * This module has NO subject loader, and the absence is the decision.
 *
 * Every `user:*` rule reads exactly one Subject field, `userId`, through `isSelf`
 * (combinators.ts:46-49) and `not(isSelf)` (combinators.ts:129-131). The target's id
 * is already in the path, so a loader would spend a query on a column no rule reads —
 * the departments.routes.ts:15-29 argument — and it would make things worse, not just
 * slower: a loader that returns `undefined` for a missing row (the courses.service.ts:82-91
 * pattern) would answer an ADMIN with 403 where the service's `notFound('User')` is the
 * truthful 404, and admins are the only callers who can address someone else's id at all.
 *
 * The subjects are therefore built inline at the two routes that need them, in
 * users.routes.ts.
 */

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * `user:list` is role-only (policy.ts:319-324: anonymous/STUDENT/TEACHER deny, ADMIN
 * allow), so — unlike `GET /enrollments` or `GET /courses` — this list has NO
 * `visibilityWhere`. There is no row scoping to mirror, because the only role that
 * reaches the handler may see every row. The clause below is caller FILTERS plus the
 * soft-delete rule, and nothing about permissions.
 */
function listWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [];

  if (query.q !== undefined) {
    // v1 substring match over the two columns the admin console searches by.
    // `email` is `@db.Citext` (schema.prisma:132), so it is already case-insensitive
    // at the type level; `mode: 'insensitive'` is stated anyway so the two branches
    // read the same and `name`, a plain String, behaves identically.
    filters.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  if (query.departmentId !== undefined) {
    // There is no `User.departmentId`. A person belongs to a department through
    // whichever profile they have (schema.prisma:186-221), and an ADMIN has neither —
    // so this filter deliberately excludes admins rather than pretending they are
    // departmentless members of the one asked for.
    filters.push({
      OR: [
        { teacherProfile: { is: { departmentId: query.departmentId } } },
        { studentProfile: { is: { departmentId: query.departmentId } } },
      ],
    });
  }

  return {
    deletedAt: null,
    // exactOptionalPropertyTypes: `{ role: undefined }` is not assignable to an
    // optional field, so each key is spread in or left out entirely.
    ...(query.role !== undefined ? { role: query.role } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    // Collected into AND because the two filters above each own a top-level OR and a
    // second one would silently replace the first.
    AND: filters,
  };
}

/**
 * `sort` arrives as free-form text (pagination.ts:16), so it is matched against this
 * whitelist and never interpolated into an `orderBy` key. An unrecognised value falls
 * back to `createdAt` rather than 422ing — the SPA sends no `sort` at all today
 * (AdminUsers.tsx:51-64) and a typo in a URL is not worth an error page.
 *
 * Every branch is an indexed column: @@index([role, status]), @@index([status]),
 * @@index([createdAt]) (schema.prisma:180-183).
 */
function orderFor(query: ListUsersQuery): Prisma.UserOrderByWithRelationInput {
  switch (query.sort) {
    case 'name':
      return { name: query.order };
    case 'email':
      return { email: query.order };
    case 'lastLoginAt':
      return { lastLoginAt: query.order };
    case 'role':
      return { role: query.order };
    case 'status':
      return { status: query.order };
    default:
      return { createdAt: query.order };
  }
}

/**
 * Serves `userDetailSchema` rows, not `userSummarySchema` ones, because
 * AdminUsers.tsx renders `email` (:126,:162), `status` (:147,:170), the department
 * name (:135,:172) and `lastLoginAt` (:141) — and the summary carries only
 * { id, name, role, avatarUrl } (user.ts:22-27), which cannot draw that page.
 *
 * That is not a leak: `user:list` is ADMIN-only in every cell, so this endpoint is
 * unreachable for anyone who should not see a contact detail.
 */
export async function list(query: ListUsersQuery): Promise<Paginated<UserDetail>> {
  const where = listWhere(query);
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: USER_DETAIL_INCLUDE,
    }),
    prisma.user.count({ where }),
  ]);
  return { data: rows.map(toUserDetail), meta: paginationMeta(query.page, query.limit, total) };
}

export function getById(id: string): Promise<UserDetail> {
  return detailById(id);
}

/** `GET /users/me`. The id comes off the session, never off the request. */
export function getSelf(actor: Actor): Promise<UserDetail> {
  return detailById(actor.id);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * `PATCH /users/me`. `updateUserSchema` (user.ts:70-80) carries no `role` and no
 * `status` by design, so there is nothing to strip here: privilege changes are admin
 * verbs with their own actions, and this body cannot express one.
 */
export async function updateSelf(actor: Actor, input: UpdateUserInput): Promise<UserDetail> {
  /*
   * `avatarUploadId` is a REAL foreign key (schema.prisma:143-144) and the uploads
   * module does not exist yet, so no client can be holding a valid id. Left to Prisma
   * it would be a P2003 rendered as a bare 409 (errors.plugin.ts:45-62); rejected here
   * it is a field-level 422 that says why — the courses.service.ts:296-315 rule that a
   * client-chosen foreign key is checked FIRST.
   *
   * `null` is allowed through: clearing an avatar needs no Upload row, and
   * `updateUserSchema.avatarUploadId` is `idSchema.nullable()` precisely so it can be
   * cleared. TODO(uploads): drop this guard and validate the id against Upload when
   * the uploads module lands — courses.service.ts:68-70 carries the twin of this note
   * for `syllabusUrl`.
   */
  if (input.avatarUploadId !== undefined && input.avatarUploadId !== null) {
    throw validationFailed([{ path: 'avatarUploadId', message: 'Uploads are not available yet' }]);
  }

  await prisma.user.update({
    where: { id: actor.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.avatarUploadId !== undefined ? { avatarUploadId: input.avatarUploadId } : {}),
    },
  });

  // The audit row is written by the Prisma extension (User is in AUDITED_MODELS,
  // audit.ts:51-59); writing one here too would double every edit.
  //
  // Re-read rather than `include` on the update: `updateUserSchema` can change a
  // profile's department in no way at all, but the include is the one place the two
  // joins are spelled and detailById is where the soft-delete filter lives.
  return detailById(actor.id);
}

/**
 * `POST /users/:id/suspend`.
 *
 * Two writes, SEQUENTIALLY and deliberately not in one interactive transaction. `User`
 * is an AUDITED model, so `prisma.user.update` makes the audit extension write an
 * AuditEvent on a SECOND pool from inside the call (audit.ts:225-232). Wrapping that
 * in `prisma.$transaction(async tx => …)` next to a second statement is the shape that
 * deadlocks the pool under concurrency and surfaces as P2024 reading like slowness —
 * the trap enrollments.service.ts:41-50 pays a 15s budget to survive. Nothing here
 * needs atomicity: a suspension whose session sweep failed is re-run by
 * auth.plugin.ts:63-67 the moment any surviving cookie is presented.
 *
 * The status transition ACTIVE -> SUSPENDED is what makes the extension derive the
 * SUSPEND action (audit.ts:161-163). NO manual audit row is written.
 */
export async function suspend(id: string, input?: SuspendUserInput): Promise<UserDetail> {
  const current = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!current) throw notFound('User');

  if (current.status === 'SUSPENDED') {
    // Idempotent: a double click returns the row unchanged rather than writing a
    // second SUSPEND audit row, the enrollments.service.ts:389-398 pattern. The
    // extension derives its action from a TRANSITION, so a no-op update would be
    // recorded as a plain UPDATE and muddy the trail rather than repeat it.
    return detailById(id);
  }

  const reason = input?.reason ?? DEFAULT_SUSPENSION_REASON;

  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });

  /*
   * auth.plugin.ts:63-67 already destroys every session the next time one is
   * presented, so this is not what makes suspension effective — it is what makes it
   * IMMEDIATE, and what makes the SPA's toast ("Every session for that account has
   * been destroyed", AdminUsers.tsx:70-72) true at the moment it is shown rather than
   * at the suspended user's next request.
   */
  const revoked = await destroyAllSessions(id);

  // The only home the reason has today; see DEFAULT_SUSPENSION_REASON above.
  log.info({ userId: id, reason, revoked }, 'user suspended');

  return detailById(id);
}
