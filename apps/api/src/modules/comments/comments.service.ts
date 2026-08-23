import { prisma, type Prisma } from '@skillwright/db';
import {
  allowed,
  can,
  paginationMeta,
  toSkipTake,
  type Actor,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../lib/dto.js';
import { forbidden, notFound, validationFailed } from '../../lib/errors.js';
import { notify } from '../notifications/notifications.service.js';
// The Resource row, and the question of who may read it, belong to the resources
// module. `loadResourceSubject` is reused rather than re-queried here — same
// reasoning courses.service.ts's `assertUploadClaimable` import from uploads.service.ts
// documents: a second copy of "what can this actor see on this resource" would drift
// from the original the first time either one changed.
import {
  loadResourceSubject,
  visibilityWhere as resourceVisibilityWhere,
} from '../resources/resources.service.js';
import type {
  CommentDto,
  CreateCommentInput,
  ListCommentsQuery,
  UpdateCommentInput,
} from './comments.schema.js';

/**
 * Exactly the relations `toCommentDto` reads, as one include every query spreads.
 *
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `CommentGetPayload` widens to `boolean` and the mapper stops being
 * checked against the columns it reads.
 *
 * `resource` is selected only for its course's `teacherId` — the one extra field
 * `comment:delete`'s TEACHER row (policy.ts) needs to decide `ownsCourse`. A comment
 * on an announcement has no course at all, so `resource` comes back `null` there and
 * `ownsCourse` denies for it; that is correct, not a gap — announcements are not
 * scoped to a course, so only the author (or an admin) may remove a comment on one.
 *
 * The reply count filters `deletedAt` by hand because soft delete is not enforced by
 * the ORM, exactly as resources.service.ts's `RESOURCE_INCLUDE` counts comments.
 */
const COMMENT_INCLUDE = {
  author: { select: USER_SUMMARY_SELECT },
  resource: { select: { course: { select: { teacherId: true } } } },
  _count: { select: { replies: { where: { deletedAt: null } } } },
} as const;

type CommentWithRelations = Prisma.CommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/**
 * The ONLY shape a comment is serialised as.
 *
 * `canEdit`/`canDelete` are computed here, against the REQUESTING actor, with the
 * same `allowed()` the SPA would otherwise have to reimplement client-side — the
 * point being that a wire response is self-describing about what its own recipient
 * may do to it, rather than the SPA re-deriving `comment:update`/`comment:delete`
 * from a partial view of the row. `allowed()` is the boolean-only wrapper around
 * `can()` built for exactly this ("UI affordances, where the reason is never
 * rendered" — can.ts).
 */
export function toCommentDto(comment: CommentWithRelations, actor: Actor): CommentDto {
  const subject: Subject = {
    id: comment.id,
    authorId: comment.authorId,
    ...(comment.resource ? { courseTeacherId: comment.resource.course.teacherId } : {}),
  };

  return {
    id: comment.id,
    content: comment.content,
    author: toUserSummary(comment.author),
    resourceId: comment.resourceId,
    announcementId: comment.announcementId,
    parentId: comment.parentId,
    replyCount: comment._count.replies,
    canEdit: allowed(actor, 'comment:update', subject),
    canDelete: allowed(actor, 'comment:delete', subject),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    // Comment has no `editedAt` column (unlike Message, whose schema.prisma model
    // carries one) — `create` sets `createdAt`/`updatedAt` to the same instant, so
    // any divergence between them can only come from a content patch. Derived
    // rather than stored, so there is nothing here for a migration to add.
    editedAt:
      comment.updatedAt.getTime() !== comment.createdAt.getTime()
        ? comment.updatedAt.toISOString()
        : null,
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * Subject for `comment:update` and `comment:delete` — every gate that names one row.
 *
 * `undefined` for a missing or soft-deleted comment so the policy denies. Unlike
 * `resource:read`, every role's `comment:update` cell is `isAuthor` (policy.ts) —
 * there is no `allow` cell to fall through on a missing row — so a caller can never
 * reach `update()` below with an id that does not exist; only `comment:delete`'s
 * ADMIN cell is unconditional `allow`, which is why `remove()` still 404s by hand.
 *
 * Every field a comment rule reads is named individually rather than spread, on the
 * same reasoning resources.service.ts's `loadResourceSubject` documents: a spread
 * skips TypeScript's excess-property check, so a misspelled key would deny silently.
 *   authorId         -> isAuthor    (combinators.ts)
 *   courseTeacherId   -> ownsCourse  (combinators.ts) — present only when the
 *                        comment hangs off a resource; see `COMMENT_INCLUDE` above.
 */
export async function loadCommentSubject(id: string): Promise<Subject | undefined> {
  const comment = await prisma.comment.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      authorId: true,
      resource: { select: { course: { select: { teacherId: true } } } },
    },
  });
  if (!comment) return undefined;

  return {
    id: comment.id,
    authorId: comment.authorId,
    ...(comment.resource ? { courseTeacherId: comment.resource.course.teacherId } : {}),
  };
}

/**
 * Subject for `announcement:read`, mirroring `loadResourceSubject`
 * (resources.service.ts) for the one action this module needs to decide against an
 * Announcement row. There is no announcements module yet to import this from — see
 * `announcementVisibilityWhere` below for the read-side counterpart and the same
 * caveat.
 */
async function loadAnnouncementSubject(id: string): Promise<Subject | undefined> {
  const announcement = await prisma.announcement.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, authorId: true, publishedAt: true },
  });
  if (!announcement) return undefined;

  return {
    id: announcement.id,
    authorId: announcement.authorId,
    publishedAt: announcement.publishedAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `announcement:read` (policy.ts) expressed as a WHERE clause, the same shape
 * resources.service.ts's `visibilityWhere` is for `resource:read`. There is no
 * announcements module yet whose export this can be reused from, so it is mirrored
 * here instead of written twice once that module exists:
 *   STUDENT -> isPublished
 *   TEACHER -> or(isPublished, isAuthor)
 *   ADMIN   -> allow
 * (anonymous is omitted: `comment:read` denies anonymous outright, so this function
 * is only ever called with a real `Actor`.)
 *
 * IF THIS FUNCTION AND policy.ts DISAGREE, THIS FUNCTION IS THE BUG — the same
 * warning resources.service.ts's `visibilityWhere` carries for itself.
 */
function announcementVisibilityWhere(actor: Actor): Prisma.AnnouncementWhereInput {
  const live: Prisma.AnnouncementWhereInput = { deletedAt: null };
  const published: Prisma.AnnouncementWhereInput = { publishedAt: { not: null } };

  switch (actor.role) {
    case 'ADMIN':
      return live;
    case 'TEACHER':
      return { AND: [live, { OR: [published, { authorId: actor.id }] }] };
    case 'STUDENT':
      return { AND: [live, published] };
  }
}

/**
 * `?resourceId=` branch of the list: comments on ONE resource, bounded by that
 * resource's own visibility. A nested relation filter — not a second `id` clause —
 * so the query only matches when a live row exists at the far end AND that row
 * satisfies `resourceVisibilityWhere`; reusing the resources module's own mirror
 * rather than a second copy is what LESSONS-LEARNED #33 asks for: a child's
 * visibility must be BOUNDED by its parent's, in exactly one place.
 */
function resourceCommentsWhere(actor: Actor, resourceId: string): Prisma.CommentWhereInput {
  return { resourceId, resource: resourceVisibilityWhere(actor) };
}

/** `?announcementId=` branch of the list — the same shape, against `announcementVisibilityWhere`. */
function announcementCommentsWhere(actor: Actor, announcementId: string): Prisma.CommentWhereInput {
  return { announcementId, announcement: announcementVisibilityWhere(actor) };
}

/**
 * `listCommentsQuerySchema` (comment.ts) leaves `resourceId`/`announcementId` both
 * optional at the zod layer — there is no cross-field `superRefine` on the query the
 * way `createCommentSchema`'s body has one — so the exactly-one rule is enforced
 * here instead, the same 422-with-a-field-path shape `assertCourseExists`
 * (resources.service.ts) uses for a client-chosen id that fails a business rule.
 */
function assertExactlyOneParent(query: ListCommentsQuery): void {
  const targets = [query.resourceId, query.announcementId].filter((v) => v !== undefined);
  if (targets.length !== 1) {
    throw validationFailed([
      { path: 'resourceId', message: 'Pass exactly one of resourceId or announcementId.' },
    ]);
  }
}

/**
 * `comment:read` (policy.ts) is `allow` for every authenticated role — subject-
 * independent, so it decides nothing about which ROWS come back. What bounds a list
 * is the PARENT's own visibility: a comment on a resource or announcement the
 * caller cannot read must not be listed either, or the comment thread becomes a way
 * to read a row through a side door. `comment:read`'s anonymous `deny` is enforced
 * by the route requiring a session (`requireActor`) before this ever runs, not by a
 * subject-free `authorize()` here — see comments.routes.ts.
 *
 * `parentId` narrows to one thread's direct replies when passed; omitted, it
 * defaults to top-level comments only (`listCommentsQuerySchema`'s own doc comment).
 */
function listWhere(actor: Actor, query: ListCommentsQuery): Prisma.CommentWhereInput {
  assertExactlyOneParent(query);

  let parent: Prisma.CommentWhereInput;
  if (query.resourceId !== undefined) {
    parent = resourceCommentsWhere(actor, query.resourceId);
  } else if (query.announcementId !== undefined) {
    parent = announcementCommentsWhere(actor, query.announcementId);
  } else {
    // Unreachable: assertExactlyOneParent has already thrown for this shape.
    throw validationFailed([
      { path: 'resourceId', message: 'Pass exactly one of resourceId or announcementId.' },
    ]);
  }

  const thread: Prisma.CommentWhereInput =
    query.parentId !== undefined ? { parentId: query.parentId } : { parentId: null };

  return { AND: [{ deletedAt: null }, parent, thread] };
}

export async function list(actor: Actor, query: ListCommentsQuery): Promise<Paginated<CommentDto>> {
  const where = listWhere(actor, query);

  const [rows, total] = await prisma.$transaction([
    prisma.comment.findMany({
      where,
      ...toSkipTake(query),
      orderBy: { createdAt: query.order },
      include: COMMENT_INCLUDE,
    }),
    prisma.comment.count({ where }),
  ]);

  return {
    data: rows.map((row) => toCommentDto(row, actor)),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * `comment:create` (policy.ts) is role-only — deny anonymous, allow every
 * authenticated role — so it cannot see WHICH resource or announcement the caller
 * is attaching to. That is this function's job, run after the route's
 * `authorize('comment:create')` has already accepted the caller's ROLE: a caller
 * who cannot READ the parent must not be able to attach a comment to it either, or
 * `GET /comments?resourceId=` would surface a row nobody with that view could
 * otherwise see the parent of.
 *
 * A missing parent id is a 422 on the offending field — the same shape
 * `assertCourseExists` (resources.service.ts) uses for a client-chosen foreign key
 * that resolves to nothing. A parent that EXISTS but the caller may not read is a
 * 403, built from `can()`'s own `reason`/`rule` exactly as `authorize()`
 * (auth.plugin.ts) builds one at the route boundary — this check runs the identical
 * decision one layer down, because there is no single row for a route-level gate to
 * name in advance.
 */
async function assertCanReadParent(actor: Actor, input: CreateCommentInput): Promise<void> {
  if (input.resourceId !== undefined) {
    const subject = await loadResourceSubject(input.resourceId, actor);
    if (subject === undefined) {
      throw validationFailed([{ path: 'resourceId', message: 'Unknown resource' }]);
    }
    const result = can(actor, 'resource:read', subject);
    if (!result.allowed) throw forbidden(result.reason, result.rule);
    return;
  }

  if (input.announcementId !== undefined) {
    const subject = await loadAnnouncementSubject(input.announcementId);
    if (subject === undefined) {
      throw validationFailed([{ path: 'announcementId', message: 'Unknown announcement' }]);
    }
    const result = can(actor, 'announcement:read', subject);
    if (!result.allowed) throw forbidden(result.reason, result.rule);
    return;
  }

  // Unreachable: createCommentSchema's superRefine already refuses a body naming
  // neither target.
  throw validationFailed([
    { path: 'resourceId', message: 'A comment attaches to exactly one resource or announcement.' },
  ]);
}

/**
 * Threading is one level deep. `parentId` must name a top-level, live comment
 * attached to the SAME parent as the reply — a 422 on `parentId`, since by the time
 * this runs `assertCanReadParent` has already confirmed the caller may see that
 * parent, so a bad `parentId` here is a bad request rather than a hidden row.
 *
 * Returns the validated parent row, because its `authorId` is exactly who
 * COMMENT_REPLIED reaches — loading it here rather than re-querying in `create` keeps
 * one read per reply. `undefined` for a top-level comment, which announces nothing.
 */
async function assertValidParent(
  input: CreateCommentInput,
): Promise<
  { authorId: string; resourceId: string | null; announcementId: string | null } | undefined
> {
  if (input.parentId === undefined) return undefined;

  const parent = await prisma.comment.findFirst({
    where: { id: input.parentId, deletedAt: null },
    select: { authorId: true, parentId: true, resourceId: true, announcementId: true },
  });
  if (!parent) {
    throw validationFailed([{ path: 'parentId', message: 'Unknown parent comment' }]);
  }
  if (parent.parentId !== null) {
    throw validationFailed([
      { path: 'parentId', message: 'Threading is one level: reply to a top-level comment only.' },
    ]);
  }
  const sameParent =
    parent.resourceId === (input.resourceId ?? null) &&
    parent.announcementId === (input.announcementId ?? null);
  if (!sameParent) {
    throw validationFailed([
      {
        path: 'parentId',
        message: 'The parent comment belongs to a different resource or announcement.',
      },
    ]);
  }
  return parent;
}

/**
 * The author is the ACTOR, never the body — `createCommentSchema` has no
 * `authorId` field (comment.ts), and accepting one would be a way to forge
 * attribution, the same reasoning `resource.create`'s doc comment states.
 *
 * No audit row is written by hand: `Comment` is in `AUDITED_MODELS`
 * (packages/db/src/audit.ts), so the Prisma extension writes it.
 */
export async function create(actor: Actor, input: CreateCommentInput): Promise<CommentDto> {
  await assertCanReadParent(actor, input);
  const parent = await assertValidParent(input);

  const comment = await prisma.comment.create({
    data: {
      authorId: actor.id,
      content: input.content,
      // `?? null` on all three, never `undefined`: the CHECK in migration 0002
      // counts non-nulls, and `createCommentSchema`'s `superRefine` has already
      // refused a body that sets neither or both of resourceId/announcementId.
      resourceId: input.resourceId ?? null,
      announcementId: input.announcementId ?? null,
      parentId: input.parentId ?? null,
    },
    include: COMMENT_INCLUDE,
  });

  if (parent) {
    // COMMENT_REPLIED, after the create above has committed — best-effort, never
    // throws. The reply to a top-level comment is the only shape threading allows
    // (assertValidParent), and the self-reply case is excluded here: answering your
    // own comment is not news worth a bell. There is deliberately no enum member for
    // a top-level comment yet — recorded as a known debt in the Phase 1 section of
    // docs/roadmap/00-FEATURE-PLAN.md.
    if (parent.authorId !== actor.id) {
      await notify({
        userIds: [parent.authorId],
        type: 'COMMENT_REPLIED',
        title: 'New reply',
        body: `${comment.author.name} replied to your comment.`,
        linkPath:
          parent.resourceId !== null
            ? `/resources/${parent.resourceId}`
            : `/announcements/${parent.announcementId}`,
      });
    }
  }

  return toCommentDto(comment, actor);
}

/**
 * No pre-update existence check, the same call enrollments.service.ts's `getById`
 * makes after its own subject loader: `comment:update` is `isAuthor` for EVERY
 * role, with no `allow` cell to fall through — a missing or foreign comment id
 * already denied at `authorize()` before this function runs, so reaching here at
 * all means the subject loader found the row. A P2025 here is the race, not the
 * path, and errors.plugin.ts already turns it into a 404.
 */
export async function update(
  id: string,
  actor: Actor,
  input: UpdateCommentInput,
): Promise<CommentDto> {
  const comment = await prisma.comment.update({
    where: { id },
    data: { content: input.content },
    include: COMMENT_INCLUDE,
  });

  return toCommentDto(comment, actor);
}

/**
 * SOFT delete only, on the same schema.prisma rule (soft delete over hard) every
 * other module in this codebase follows. Unlike `update`, `comment:delete`'s ADMIN
 * cell is unconditional `allow` (policy.ts), so an admin passes the gate on an id
 * that does not exist — the existence check below is what turns that into a
 * truthful 404 instead of a silent 204, the same reasoning resources.service.ts's
 * `remove` documents for itself.
 */
export async function remove(id: string): Promise<void> {
  const comment = await prisma.comment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!comment) throw notFound('Comment');

  await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
}
