import { prisma, type Prisma } from '@skillwright/db';
import {
  bulkImportRowSchema,
  paginationMeta,
  toSkipTake,
  type Actor,
  type BulkImportFailureCode,
  type BulkImportInput,
  type BulkImportResult,
  type CreateUserInput,
  type FieldError,
  type Paginated,
  type Role,
} from '@skillwright/shared';
import { ulid } from 'ulid';
import { conflict, isAppError, notFound, validationFailed } from '../../lib/errors.js';
import { baseLogger } from '../../lib/logger.js';
import { presignGet, safeFilename } from '../../lib/storage.js';
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
import { assertUploadClaimable } from '../uploads/uploads.service.js';
import { notify } from '../notifications/notifications.service.js';
import { destroyAllSessions } from '../auth/session.service.js';
import type {
  ListUsersQuery,
  ReinstateUserInput,
  SuspendUserInput,
  UpdateUserInput,
  UserDetail,
} from './users.schema.js';

const log = baseLogger.child({ module: 'users' });

/**
 * The relations `toUserDetail` reads. There is NO `User.departmentId` column
 * (`model User` in schema.prisma carries no such field) — a person's department hangs off
 * whichever profile they
 * have, so the department name the console renders arrives through two joins and not
 * one field.
 *
 * `avatarUpload` is what lets this module prefer an uploaded avatar over the derived
 * one: `avatarUrlFor` (packages/db/src/avatar.ts) takes only a userId and can never see
 * the upload, so the preference resolves HERE, where the row is loaded with its
 * relation — see `withAvatarUrl`. Only key/originalName/status are selected; no bytes
 * ever flow through this process.
 *
 * This is a byte-for-byte copy of auth.service.ts:69-72 on purpose, and it is the
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
  avatarUpload: { select: { key: true, originalName: true, status: true } },
} as const;

/**
 * The uploaded avatar, when there is one worth serving.
 *
 * `toUserDetail` itself stays synchronous (it is embedded in list mappings) and always
 * writes the deterministic fallback; this wraps it with the ONE async step — a signed
 * GET for the committed upload, same 5-minute TTL and `attachment` disposition as every
 * other download. PENDING or absent falls through to the fallback: a URL for unverified
 * bytes would render as a broken image in every <img> tag that holds it.
 *
 * The auth flows' own responses (login, session, MFA) go through
 * auth.service.ts:loadUserDetail, whose PROFILE_INCLUDE does not carry this relation,
 * and keep the derived avatar — noted at that file's avatar line rather than fixed
 * here, because changing that include is outside this change's fences.
 */
async function withAvatarUrl(
  user: Prisma.UserGetPayload<{ include: typeof USER_DETAIL_INCLUDE }>,
): Promise<UserDetail> {
  const detail = toUserDetail(user);
  const { avatarUpload } = user;
  if (avatarUpload === null || avatarUpload.status !== 'COMMITTED') return detail;

  const signed = await presignGet({
    key: avatarUpload.key,
    filename: safeFilename(avatarUpload.originalName),
  });
  return { ...detail, avatarUrl: signed.url };
}

/**
 * user.ts:141 — "Suspension always carries a reason; it lands in the audit row and the
 * email." The SPA posts no body at all (AdminUsers.tsx:67), so the route binds
 * `suspendUserSchema.nullish()` and an absent reason becomes this.
 *
 * The reason has nowhere to be STORED: `User` has no suspension-reason column
 * (`model User` in schema.prisma) and the audit row is written by the Prisma extension,
 * which snapshots columns and cannot be handed free text (`record()` in audit.ts, whose
 * `params` carry no free-text field). Writing an
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
 * `toUserDetail` is the module's entity mapper and is imported above. `avatarUrl`
 * starts as the derived fallback inside it (packages/db/src/avatar.ts:13) and is
 * replaced by a signed URL for the caller's uploaded avatar in `withAvatarUrl` when the
 * row carries one; `mfaEnabled` is `totpEnabledAt !== null`, both inside that one
 * function.
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
  return withAvatarUrl(user);
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
 * `user:list` is role-only (`POLICY`: anonymous/STUDENT/TEACHER deny, ADMIN
 * allow), so — unlike `GET /enrollments` or `GET /courses` — this list has NO
 * `visibilityWhere`. There is no row scoping to mirror, because the only role that
 * reaches the handler may see every row. The clause below is caller FILTERS plus the
 * soft-delete rule, and nothing about permissions.
 */
function listWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [];

  if (query.q !== undefined) {
    // v1 substring match over the two columns the admin console searches by.
    // `email` is `@db.Citext` (declared on `model User`), so it is already case-insensitive
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
    // whichever profile they have (`model TeacherProfile` / `model StudentProfile` in
    // schema.prisma), and an ADMIN has neither —
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
 * @@index([createdAt]) — all three declared on `model User` in schema.prisma.
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
  return {
    data: await Promise.all(rows.map((row) => withAvatarUrl(row))),
    meta: paginationMeta(query.page, query.limit, total),
  };
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
 * `PATCH /users/me`. `updateUserSchema` (user.ts:80-98) carries no `role` and no
 * `status` by design, so there is nothing to strip here: privilege changes are admin
 * verbs with their own actions, and this body cannot express one.
 */
export async function updateSelf(actor: Actor, input: UpdateUserInput): Promise<UserDetail> {
  /*
   * `avatarUploadId` is a client-chosen foreign key (declared on `model User` in
   * schema.prisma, `onDelete: SetNull`), so it is
   * checked FIRST — left to Prisma it would be a P2003 rendered as a bare 409, and the
   * courses.service.ts:296-315 rule turns that into a field-level 422.
   *
   * `null` is allowed through: clearing an avatar needs no Upload row, and
   * `updateUserSchema.avatarUploadId` is `idSchema.nullable()` precisely so it can be
   * cleared. A non-null id must be the caller's own COMMITTED upload MINTED AS AN
   * AVATAR: `assertUploadClaimable`'s four questions plus its purpose check against the
   * key prefix, which is the only record of a purpose that exists. Without the purpose
   * half, an upload presigned as a RESOURCE — up to 512 MB of any MIME the purpose
   * accepts — could be attached as a face and served through an <img> tag.
   *
   * This check lives HERE rather than in the shared writer below because ownership is
   * a CALLER question: on the `/me` path the caller is the target, which is what makes
   * `actor` the right argument to assertUploadClaimable.
   */
  if (input.avatarUploadId !== undefined && input.avatarUploadId !== null) {
    await assertUploadClaimable(input.avatarUploadId, actor, 'avatarUploadId', 'AVATAR');
  }

  await applyUserUpdate(actor.id, actor.role, input);
  // Re-read rather than `include` on the write: detailById is where the soft-delete
  // filter lives and the one place the two profile joins are spelled.
  return detailById(actor.id);
}

/**
 * `PATCH /users/:id` — the admin path through the same `user:update` action and the
 * same body schema as `/me`. The subject is the TARGET (users.routes.ts), so policy
 * already refuses STUDENT and TEACHER callers before this runs; what the service adds
 * is the target's identity and role, which decide whose row changes and which profile
 * fields are legitimate for them.
 */
export async function update(id: string, input: UpdateUserInput): Promise<UserDetail> {
  /*
   * An upload can only be attached by its owner: `assertUploadClaimable` checks the
   * CALLER's ownership, which on this path is the wrong person unless admin == target,
   * and an admin planting their own face on someone else's account is not a flow that
   * exists. Refusing the field outright beats silently ignoring it.
   */
  if (input.avatarUploadId !== undefined) {
    throw validationFailed([
      {
        path: 'avatarUploadId',
        message:
          'Avatars are attached by their owner; sign in as that person and use PATCH /users/me.',
      },
    ]);
  }

  const target = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) throw notFound('User');

  await applyUserUpdate(target.id, target.role, input);
  return detailById(id);
}

/**
 * The write half shared by `/me` and `/:id`. Sequential awaits, NOT one interactive
 * transaction — `User` is audited and the extension writes from a second pool inside
 * any transaction window (the suspend comment below records the P2024 shape that buys).
 * Nothing here needs atomicity: a profile edit split from its name edit by a crash
 * leaves two half-truths an operator can see, not a corrupt invariant.
 */
async function applyUserUpdate(userId: string, role: Role, input: UpdateUserInput): Promise<void> {
  rejectMismatchedProfileFields(role, input);

  const hasUserScalars =
    input.name !== undefined ||
    input.phoneNumber !== undefined ||
    input.bio !== undefined ||
    input.avatarUploadId !== undefined;

  if (hasUserScalars) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUploadId !== undefined ? { avatarUploadId: input.avatarUploadId } : {}),
      },
    });
    // The audit row is written by the Prisma extension (User is in `AUDITED_MODELS`,
    // packages/db/src/audit.ts); writing one here too would double every edit.
  }

  await applyProfileUpdate(userId, role, input);
}

/**
 * Which profile columns belong to which role. A field sent by the wrong role is a
 * field-level 422, never a silent ignore — a silent ignore reads as success while the
 * caller's qualification lands nowhere, which is exactly the failure mode the SPA
 * cannot distinguish from a saved form.
 *
 * Annotated as a full Record rather than `as const`: the per-key literal tuples would
 * make `.includes(role)` on a keyed union take a `never` argument.
 */
const PROFILE_FIELD_ROLES: Readonly<
  Record<'qualification' | 'specialization' | 'staffNo' | 'enrollmentNo', readonly Role[]>
> = {
  qualification: ['TEACHER'],
  specialization: ['TEACHER'],
  staffNo: ['TEACHER'],
  enrollmentNo: ['STUDENT'],
};

/** Structurally satisfied by both `UpdateUserInput` and `CreateUserInput`. */
type ProfileFieldSource = Partial<Record<keyof typeof PROFILE_FIELD_ROLES, unknown>>;

function rejectMismatchedProfileFields(role: Role, fields: ProfileFieldSource): void {
  const errors: FieldError[] = (
    Object.keys(PROFILE_FIELD_ROLES) as Array<keyof typeof PROFILE_FIELD_ROLES>
  )
    .filter((field) => fields[field] !== undefined && !PROFILE_FIELD_ROLES[field].includes(role))
    .map((field) => ({
      path: field,
      message: `${field} applies to ${PROFILE_FIELD_ROLES[field].join(' and ')} accounts only.`,
    }));
  if (errors.length > 0) throw validationFailed(errors);
}

/**
 * Creates-or-updates the caller's profile satellite from the schema's profile fields.
 *
 * "Upsert" degenerates to update here, and that is not laziness: CREATING a profile
 * row requires a departmentId, there is no `User.departmentId` column to fall back to,
 * and department placement is deliberately absent from `updateUserSchema`. A person
 * without their role's profile row is therefore a data anomaly only an operator can
 * repair (every provisioned, registered and seeded teacher/student gets one), so the
 * honest answer is a 409 naming the gap rather than an invented department.
 *
 * Profile rows are not in `AUDITED_MODELS` (packages/db/src/audit.ts): they are
 * satellites of the User, whose own UPDATE row carries the request when any scalar
 * moved alongside.
 */
async function applyProfileUpdate(
  userId: string,
  role: Role,
  input: UpdateUserInput,
): Promise<void> {
  if (role === 'TEACHER') {
    const data = {
      ...(input.qualification !== undefined ? { qualification: input.qualification } : {}),
      ...(input.specialization !== undefined ? { specialization: input.specialization } : {}),
      ...(input.staffNo !== undefined ? { staffNo: input.staffNo } : {}),
    };
    if (Object.keys(data).length === 0) return;

    const existing = await prisma.teacherProfile.findUnique({ where: { userId } });
    if (!existing) throw conflict('This account has no teacher profile to update');
    await prisma.teacherProfile.update({ where: { userId }, data });
    return;
  }

  if (role === 'STUDENT') {
    if (input.enrollmentNo === undefined) return;

    const existing = await prisma.studentProfile.findUnique({ where: { userId } });
    if (!existing) throw conflict('This account has no student profile to update');
    // A number someone else already holds is a P2002 -> 409 from errors.plugin.ts,
    // the same arbiter registration relies on.
    await prisma.studentProfile.update({
      where: { userId },
      data: { enrollmentNo: input.enrollmentNo },
    });
  }
  // ADMIN: no profile satellite exists to write; the guard above already refused
  // every profile field an admin could have sent.
}

/**
 * Collision-free without a round trip: ULID's 80 random bits, rendered short.
 * Mirrors auth.service.ts's private generator of the same name; lifting both beside
 * `toUserDetail` is the TODO(dto) move recorded at the top of this file.
 */
function generateEnrollmentNo(): string {
  return `SW-${new Date().getFullYear()}-${ulid().slice(-8)}`;
}

/**
 * Duplicate email, checked BEFORE insert the way register does. The divergence from
 * register's silent ack is deliberate and audience-shaped: register answers an
 * anonymous caller, who must not learn whether an address exists, while this route's
 * caller holds `user:list` and already knows every address in the directory — hiding
 * the outcome from THEM would only make provisioning unworkable. The mechanism is
 * still register's (a pre-check that turns the collision into a deliberate branch
 * rather than a raw P2002); only the branch's answer differs. Unfiltered by deletedAt
 * because the citext unique index spans soft-deleted rows too, so a deleted account's
 * address still blocks creation and the 409 must say so truthfully.
 */
async function assertEmailAvailable(email: string): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) throw conflict('An account with this email already exists');
}

/**
 * `POST /users` — provisioning. Binds `createUserSchema` verbatim; gated bare on
 * `user:create`, which is subject-free (policy.ts), so no loader and no `requireActor`
 * are needed — `authorize` has thrown for a null actor before the handler runs.
 *
 * Password bootstrap invents nothing: the row is created WITHOUT a credential
 * (`passwordHash` stays null — the nullable `passwordHash` on `model User` in
 * schema.prisma documents exactly this state),
 * and the person sets their own password through the existing forgot/reset-password
 * flow (auth.service.ts resetPassword, delivered over Mailpit in dev). That flow also
 * flips PENDING_VERIFICATION -> ACTIVE on reset, which is why the row is created in
 * the status default rather than ACTIVE: nobody has proved they hold the mailbox yet.
 *
 * The audit CREATE row is written by the Prisma extension off `prisma.user.create`
 * (before: null, after: the row) — no manual audit call, like every other write. The
 * profile satellite rides inside the same nested write; profile rows are not audited
 * models of their own.
 */
export async function create(input: CreateUserInput): Promise<UserDetail> {
  const plan = await planCreate(input);
  const user = await prisma.user.create({ data: plan });
  return detailById(user.id);
}

/**
 * Everything `create` checks, and nothing it writes.
 *
 * Extracted so the cohort import's DRY RUN runs THE SAME CHECKS rather than a
 * restatement of them. A dry run that validated a second copy of the rules would be
 * the single most expensive possible place for the two copies to diverge: the admin
 * who trusts it uploads the file for real, and the rule that drifted is the one that
 * was wrong. So the check and the write are one function, and `dryRun` is the branch
 * that stops after the first half.
 *
 * Throws the same `AppError` `create` would, at the same field paths, which is what
 * lets `bulkImport` below map a thrown error to a per-row code without a second
 * translation table.
 *
 * NOTE WHAT IS NOT HERE: the generated `enrollmentNo` for a student who did not
 * supply one. It is produced on the way into the plan, and the plan is discarded by
 * a dry run — so a dry run cannot preview it. That is honest rather than a gap: the
 * value is a ULID, unpredictable by construction, and a dry run that printed one
 * would be promising an id the real run cannot honour.
 */
async function planCreate(input: CreateUserInput): Promise<Prisma.UserCreateInput> {
  /*
   * createUserSchema is bound verbatim, so it validates each field's SHAPE but cannot
   * fully police the role/field pairing. Anything present-but-inappropriate is refused
   * at its own path rather than dropped on the floor — the same stance updateSelf takes.
   */
  rejectMismatchedProfileFields(input.role, input);

  if (input.role === 'ADMIN') {
    // Admins have neither profile satellite nor department; there is nowhere for a
    // departmentId to go, so carrying one is refused rather than ignored.
    if (input.departmentId !== undefined) {
      throw validationFailed([
        { path: 'departmentId', message: 'Administrators do not belong to a department.' },
      ]);
    }
    await assertEmailAvailable(input.email);
    return { email: input.email, name: input.name, role: 'ADMIN' };
  }

  // TEACHER or STUDENT from here. Department validity is public information (the
  // register argument, auth.service.ts:170-178); failing here turns the Restrict FK's
  // P2003 into a field-level 422. superRefine guarantees presence for these roles;
  // the guard is restated because exactOptionalPropertyTypes wants the narrowing.
  const departmentId = input.departmentId;
  if (departmentId === undefined) {
    throw validationFailed([
      { path: 'departmentId', message: 'Teachers and students must belong to a department.' },
    ]);
  }
  const department = await prisma.department.findFirst({
    where: { id: departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw validationFailed([{ path: 'departmentId', message: 'Unknown department' }]);
  }

  // Same story as departmentId: superRefine owns this rule at the wire, the service
  // owns its narrowing.
  await assertEmailAvailable(input.email);

  // Two branches rather than one ternary-spliced create: the qualification guard can
  // only narrow `input.qualification` to string inside a branch it controls, and
  // exactOptionalPropertyTypes refuses `string | undefined` on the NOT NULL column.
  if (input.role === 'TEACHER') {
    // Same story as departmentId: superRefine owns this rule at the wire, the
    // service owns its narrowing.
    if (input.qualification === undefined) {
      throw validationFailed([
        { path: 'qualification', message: 'A teacher requires a qualification.' },
      ]);
    }
    return {
      email: input.email,
      name: input.name,
      role: 'TEACHER',
      teacherProfile: {
        create: {
          departmentId,
          qualification: input.qualification,
          specialization: input.specialization ?? null,
          staffNo: input.staffNo ?? null,
        },
      },
    };
  }

  return {
    email: input.email,
    name: input.name,
    role: 'STUDENT',
    studentProfile: {
      create: {
        departmentId,
        enrollmentNo: input.enrollmentNo ?? generateEnrollmentNo(),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Cohort import (Phase 4)
// ---------------------------------------------------------------------------

/**
 * `POST /users/bulk` — the thirty-click intake, made one request.
 *
 * IT CALLS `create` PER ROW AND NOT `createMany`, which is the whole design and
 * worth defending because the alternative looks better on paper. `createMany` is one
 * statement instead of sixty and it cannot do a single one of the three things this
 * endpoint exists to do: the audit extension's `createMany` branch records the
 * CALLER'S INPUT with no ids, for a model whose ids the database generates
 * (packages/db/src/audit.ts), so there would be no attributable row at all; it
 * cannot carry the nested `teacherProfile`/`studentProfile` satellite that gives a
 * person their department; and it cannot return the per-row result the feature is
 * for.
 *
 * SO: each row is one `create` call, and the batch is deliberately NOT ONE
 * TRANSACTION. Those two clauses in the brief are mutually exclusive and the second
 * is the one the plan argues for — "A school importing 60 people will hit 4
 * already-existing addresses and needs the other 56 to land. Do not make it
 * all-or-nothing." A single `$transaction` would roll back all sixty rows because
 * of the four, which is the exact failure the feature exists to remove. Each
 * `create` remains its own atomic unit: a nested user+profile write is ONE
 * statement, hence one implicit Postgres transaction, so the guarantee that actually
 * holds is the one that matters — a user row never exists without its profile, and
 * every row reported as created is committed.
 *
 * ONE AUDIT ROW PER CREATED USER comes from the extension firing on each
 * `prisma.user.create`, with the importing admin as the actor for all of them. It
 * is never written by hand, for the reason the extension's own comment gives: a
 * service-level `auditService.record(...)` is a line some future edit omits, and
 * this is the code path that most needed it. The test asserts the COUNT equals the
 * number created, because one summary row per import would satisfy a weaker
 * assertion and be a compliance hole.
 *
 * `dryRun` is the feature's more valuable half and the reason the request has a
 * shape at all: the first thing an admin does with an import is upload the wrong
 * file, and a wrong file that is a hundred rows of real students is not a mistake
 * anybody undoes by hand. It runs `planCreate` — the same checks, see above — and
 * writes nothing.
 *
 * NOT PARALLEL. Rows go in submission order, one await at a time, and that is
 * load-bearing rather than merely simple: `assertEmailAvailable` READS the
 * database, so a batch containing the same address twice resolves correctly only if
 * the first insert has committed before the second check runs. `Promise.all` would
 * make that a race whose outcome depends on scheduling.
 */
export async function bulkImport(input: BulkImportInput): Promise<BulkImportResult> {
  const created: UserDetail[] = [];
  const failed: BulkImportResult['failed'] = [];

  /*
   * Addresses already claimed by an EARLIER ROW OF THIS SAME BATCH.
   *
   * Without this the dry run LIES about the most common failure an import has. A
   * spreadsheet with the same address on rows 4 and 11 validates clean — neither is
   * in the database yet — and the real run then fails row 11 with a 409 the dry run
   * promised would not happen. A dry run that under-reports is worse than none: it
   * is the check people stop running once it has lied to them.
   *
   * Lower-cased because `email` is `@db.Citext` (schema.prisma), so uniqueness is
   * case-insensitive in the database and a Set of raw strings would miss the very
   * collision the insert is about to hit.
   */
  const claimed = new Set<string>();

  for (const [index, raw] of input.rows.entries()) {
    // 1-based: the person fixing the file is looking at a spreadsheet whose first
    // row is row 1, and a zero-based index sends them one line up.
    const rowNumber = index + 1;
    try {
      /*
       * PER-ROW VALIDATION, against the SAME `createUserSchema` the single-create
       * endpoint binds. The wire schema deliberately carries `z.unknown()` here
       * (see the comment on `bulkImportSchema`), so this parse is where a row's
       * SHAPE is decided — and it is the same object the route, the SPA's dry run
       * and the single-create form all use, so a rule cannot be enforced on one
       * path and forgotten on another.
       *
       * The issues are re-emitted as ONE `AppError` rather than returned as a list,
       * because `describeFailure` below projects a thrown `AppError` into the
       * per-row `code`/`detail` and nothing else in this function knows how to read
       * a ZodError. A row with three problems reports the first one; the admin fixes
       * it, re-runs the dry run, and sees the next — which is one more round trip
       * than ideal and infinitely better than a 422 that names no row at all.
       */
      const parsed = bulkImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = first?.path.join('.') ?? 'row';
        throw validationFailed([
          {
            path: field,
            message: `${field}: ${first?.message ?? 'This row is not a valid user.'}`,
          },
        ]);
      }
      const row = parsed.data;

      if (claimed.has(row.email.toLowerCase())) {
        throw conflict('An earlier row in this import already uses this email address');
      }
      claimed.add(row.email.toLowerCase());

      // The same checks, and then STOP. `created` stays empty for a dry run: the
      // SPA's results table is built from `failed`, and a dry run that listed users
      // it did not create would be reporting a fiction.
      if (input.dryRun) {
        await planCreate(row);
        continue;
      }

      created.push(await create(row));
    } catch (error) {
      failed.push({ row: rowNumber, ...describeFailure(error) });
    }
  }

  return { created, failed, dryRun: input.dryRun };
}

/**
 * A thrown error as the two fields the per-row result carries: the shared
 * `ErrorCode` the SPA already maps to copy, and the server's own sentence for it.
 *
 * An `AppError` is the only thing route and service code may throw deliberately
 * (lib/errors.ts), so its `code` is authoritative and this is a projection rather
 * than a translation. Anything else is a bug in a rule we thought we had covered,
 * and `INTERNAL` is the honest code for that — the brief asks for a `code` per row,
 * and inventing a fourteenth taxonomy value for "we did not expect this" would put
 * a branch in the SPA that can never be reached.
 */
function describeFailure(error: unknown): {
  code: BulkImportFailureCode;
  detail?: string;
} {
  if (isAppError(error)) {
    return error.detail === undefined
      ? { code: error.code }
      : { code: error.code, detail: error.detail };
  }
  return { code: 'INTERNAL' };
}

/**
 * `POST /users/:id/suspend`.
 *
 * Two writes, SEQUENTIALLY and deliberately not in one interactive transaction. `User`
 * is an AUDITED model, so `prisma.user.update` makes the audit extension write an
 * AuditEvent on a SECOND pool from inside the call (the "Two consequences" note on
 * `auditExtension` in audit.ts). Wrapping that
 * in `prisma.$transaction(async tx => …)` next to a second statement is the shape that
 * deadlocks the pool under concurrency and surfaces as P2024 reading like slowness —
 * the trap `TX_OPTIONS` in enrollments.service.ts pays a 15s budget to survive. Nothing here
 * needs atomicity: a suspension whose session sweep failed is re-run by
 * auth.plugin.ts:63-67 the moment any surviving cookie is presented.
 *
 * The status transition ACTIVE -> SUSPENDED is what makes the extension derive the
 * SUSPEND action (`deriveUpdateAction` in audit.ts). NO manual audit row is written.
 */
export async function suspend(id: string, input?: SuspendUserInput): Promise<UserDetail> {
  const current = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!current) throw notFound('User');

  if (current.status === 'SUSPENDED') {
    // Idempotent: a double click returns the row unchanged rather than writing a
    // second SUSPEND audit row, the `approve` pattern in enrollments.service.ts. The
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

  /*
   * The last unwired enum member, wired here because THIS is the day it became
   * writable: until `POST /:id/reinstate` existed, a row announcing a suspension was
   * invisible to its recipient for the row's whole life — suspension destroys every
   * session, so nobody could ever sign in to read it (docs/roadmap/00-FEATURE-PLAN.md,
   * Phase 1: "wiring it becomes one line the day reinstate ships"). Reinstatement
   * exists now, so the row has a reader waiting at the end of its possible future.
   *
   * After the writes above have committed, best-effort per notify()'s contract —
   * it catches its own failures and never fails the suspension.
   */
  await notify({
    userIds: [id],
    type: 'ACCOUNT_SUSPENDED',
    title: 'Account suspended',
    body: 'An administrator suspended your account. Sign-in is disabled until it is reinstated.',
    linkPath: '/',
  });

  return detailById(id);
}

/**
 * `POST /users/:id/reinstate` — the undo of `suspend` above, and written in its
 * image: two writes SEQUENTIALLY, never one interactive transaction, for the same
 * audited-model/second-pool reason the suspend comment records. Nothing here needs
 * atomicity; a crash between the update and the response leaves an ACTIVE account
 * whose REINSTATE audit row already says so.
 *
 * The SUSPENDED -> ACTIVE transition is what makes the extension derive the REINSTATE
 * action (audit.ts), closing the last unreachable branch of `deriveUpdateAction`. NO
 * manual audit row is written.
 */
export async function reinstate(id: string, input?: ReinstateUserInput): Promise<UserDetail> {
  const current = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!current) throw notFound('User');

  if (current.status !== 'SUSPENDED') {
    // Idempotent, on the same reasoning as suspend's own early return: the extension
    // derives its action from a TRANSITION, so "reinstate" against an ACTIVE or
    // PENDING_VERIFICATION account must return the row unchanged rather than write an
    // UPDATE-shaped audit row that reads like an event.
    return detailById(id);
  }

  await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });

  // The note has nowhere to be STORED — the same gap DEFAULT_SUSPENSION_REASON
  // documents for the suspension reason — so it is logged, where an operator can find
  // it beside the suspend entry.
  if (input?.note !== undefined) {
    log.info({ userId: id, note: input.note }, 'user reinstated');
  }

  return detailById(id);
}
