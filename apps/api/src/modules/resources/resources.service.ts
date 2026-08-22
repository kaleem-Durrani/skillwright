import { prisma, type Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type EnrollmentState,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../lib/dto.js';
import { notFound, validationFailed } from '../../lib/errors.js';
import type {
  CreateResourceInput,
  ListResourcesQuery,
  ResourceDto,
  UpdateResourceInput,
} from './resources.schema.js';

/**
 * Exactly the relations `toResourceDto` reads, as one include every query spreads.
 *
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `ResourceGetPayload` widens to `boolean` and the mapper stops being
 * checked against the columns it reads.
 *
 * The author is `USER_SUMMARY_SELECT`, never `include: { author: true }`. A bare
 * include selects every User scalar, which pulls `passwordHash` and `totpSecret` into
 * the process for every row of every page (lib/dto.ts:44-53) — a 100-row page of
 * course material would load 100 Argon2id digests to render 100 names.
 *
 * The comment count filters `deletedAt` by hand because soft delete is not enforced by
 * the ORM, exactly as courses.service.ts:34 counts resources.
 */
const RESOURCE_INCLUDE = {
  course: { select: { name: true } },
  author: { select: USER_SUMMARY_SELECT },
  // `sizeBytes`/`contentType` are Upload columns (schema.prisma:400-401) that
  // `resourceSchema` flattens onto the resource (resource.ts:26-27). A LINK resource
  // has no upload row at all, and both fields answer null.
  upload: { select: { contentType: true, sizeBytes: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

type ResourceWithRelations = Prisma.ResourceGetPayload<{ include: typeof RESOURCE_INCLUDE }>;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

/**
 * The ONLY shape a resource is serialised as.
 *
 * The return type is the shared schema's inferred type (resource.ts:32), not a
 * hand-written mirror, so a renamed field in `@skillwright/shared` is a compile error
 * here rather than a response-validation 500 at runtime.
 */
export function toResourceDto(resource: ResourceWithRelations): ResourceDto {
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    type: resource.type,
    courseId: resource.courseId,
    courseName: resource.course.name,
    author: toUserSummary(resource.author),
    isPublic: resource.isPublic,
    uploadId: resource.uploadId,
    externalUrl: resource.externalUrl,
    sizeBytes: resource.upload?.sizeBytes ?? null,
    contentType: resource.upload?.contentType ?? null,
    commentCount: resource._count.comments,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
// ---------------------------------------------------------------------------

/**
 * The actor's own enrolment status in one course, scoped to the actor.
 *
 * `Subject.enrollmentStatus` is the REQUESTING actor's status in the relevant course,
 * never the status of some arbitrary row (actor.ts:72-77) — passing someone else's is
 * the one documented way to misuse the field. Teachers, admins and anonymous visitors
 * have no enrolment to report, and `enrolledApproved` (combinators.ts:62-65) is not the
 * rule that lets either of the first two through anyway.
 *
 * Reading `actor.role` here is data scoping, not authorization; courses.service.ts:166-176
 * runs the identical lookup for `course:read`.
 */
async function viewerEnrollmentStatus(
  actor: Actor | null,
  courseId: string,
): Promise<EnrollmentState | null> {
  if (actor === null || actor.role !== 'STUDENT') return null;
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId: actor.id, courseId } },
    select: { status: true },
  });
  return enrollment?.status ?? null;
}

/**
 * Subject for `resource:read`, `:update` and `:delete` — every gate that names one row.
 *
 * `undefined` for a missing or soft-deleted row so the policy denies, rather than this
 * loader throwing a bare 404 before the gate has run. An ADMIN still passes the gate on
 * a missing id (their cell is `allow`, which reads no field), and the service below then
 * answers a truthful 404 — the right answer for the one caller entitled to know the row
 * is absent rather than hidden.
 *
 * Every field the resource rules read is populated, and each is named individually
 * rather than spread: TypeScript does not excess-property-check a spread, so
 * `{ ...resource }` would accept a misspelled key silently (LESSONS-LEARNED #18).
 *   isPublic          -> isPublic          (combinators.ts:101)
 *   enrollmentStatus  -> enrolledApproved  (combinators.ts:62-65)
 *   courseTeacherId   -> ownsCourse        (combinators.ts:55-59)
 *   authorId          -> isAuthor          (combinators.ts:68-72)
 *
 * `courseTeacherId`, NOT `teacherId`. Every `Subject` field is optional (actor.ts:49-51)
 * and a rule that reads an absent field must deny, so a wrong key here is a SILENT 403
 * that no type error and no log line will ever show you.
 */
export async function loadResourceSubject(
  id: string,
  actor: Actor | null,
): Promise<Subject | undefined> {
  const resource = await prisma.resource.findFirst({
    // Soft delete is not enforced by the ORM, so both levels are filtered by hand: a
    // resource on a deleted course is as invisible as a deleted resource.
    where: { id, deletedAt: null, course: { deletedAt: null } },
    select: {
      id: true,
      courseId: true,
      authorId: true,
      isPublic: true,
      deletedAt: true,
      course: { select: { teacherId: true } },
    },
  });
  if (!resource) return undefined;

  return {
    id: resource.id,
    courseId: resource.courseId,
    courseTeacherId: resource.course.teacherId,
    authorId: resource.authorId,
    isPublic: resource.isPublic,
    deletedAt: resource.deletedAt,
    enrollmentStatus: await viewerEnrollmentStatus(actor, resource.courseId),
  };
}

/**
 * Subject for `resource:create`, which is the COURSE and not a resource — there is no
 * row yet, and policy.ts:197-204 gates a teacher on `ownsCourse` precisely so that
 * "a teacher could file a resource into a colleague's course by guessing a courseId"
 * cannot happen. The id therefore comes off the BODY, and the author is the session.
 *
 * It duplicates courses.service.ts's `loadCourseSubject` on purpose, on the same
 * reasoning as enrollments.service.ts:125-127: the module that declares the route owns
 * the gate, and importing across modules to save five lines would make a resource write
 * fail to authorize when the courses module is refactored.
 *
 * No `enrollmentStatus`: no rule in the `resource:create` row reads it (STUDENT is a
 * flat `deny`), and a field a decision cannot use is a field that will be misread later.
 */
export async function loadResourceCourseSubject(courseId: string): Promise<Subject | undefined> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, teacherId: true, departmentId: true, publishedAt: true, deletedAt: true },
  });
  if (!course) return undefined;

  return {
    id: course.id,
    courseId: course.id,
    // ownsCourse reads `courseTeacherId` (combinators.ts:55-59), NOT `teacherId`.
    courseTeacherId: course.teacherId,
    departmentId: course.departmentId,
    publishedAt: course.publishedAt,
    deletedAt: course.deletedAt,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The `resource:read` policy rows (policy.ts:191-196) expressed as a WHERE clause.
 *
 * A list cannot ask `can()` a yes/no question — there is no single subject — so each
 * branch below mirrors one policy row and must be changed with it:
 *   anonymous -> isPublic                              (policy.ts:192)
 *   STUDENT   -> or(isPublic, enrolledApproved)        (policy.ts:193, 112)
 *   TEACHER   -> or(isPublic, ownsCourse, isAuthor)    (policy.ts:194, 113)
 *   ADMIN     -> allow                                 (policy.ts:195)
 *
 * Reading `actor.role` here is choosing which WHERE mirrors which policy row — the one
 * legitimate role read named by CONTRIBUTING.md:48-55. It is NOT a permission check:
 * IF THIS FUNCTION AND policy.ts DISAGREE, THIS FUNCTION IS THE BUG. That is why the
 * mirror lives in exactly one named place, the same arrangement
 * dashboard.service.ts:101-137 documents for the resources tile — whose count must
 * equal what this clause lists, or a tile reads 23 above a list of 4.
 *
 * The soft-delete filter covers BOTH levels: a resource on a deleted course is as
 * invisible as a deleted resource, and the ORM enforces neither.
 *
 * EXPORTED because the dashboard's `resources` tile counts exactly what this clause
 * lists, and dashboard.service.ts said so in a TODO before this module existed: "move
 * this function into resources.service.ts as its visibilityWhere and IMPORT it here —
 * do not leave a second copy behind". A second copy did land, briefly, and had already
 * dropped the deleted-COURSE term, so the tile counted rows no list would return. One
 * mirror, imported, is the whole guard against that.
 */
export function visibilityWhere(actor: Actor | null): Prisma.ResourceWhereInput {
  const live: Prisma.ResourceWhereInput = { deletedAt: null, course: { deletedAt: null } };

  // `AND` rather than a spread throughout: `live` already binds the `course` key, and
  // spreading a second `course` filter over it would REPLACE the soft-delete term
  // rather than add to it.
  if (actor === null) return { AND: [live, { isPublic: true }] };

  switch (actor.role) {
    case 'ADMIN':
      return live;
    case 'TEACHER':
      return {
        AND: [
          live,
          {
            OR: [{ isPublic: true }, { course: { teacherId: actor.id } }, { authorId: actor.id }],
          },
        ],
      };
    case 'STUDENT':
      return {
        AND: [
          live,
          {
            OR: [
              { isPublic: true },
              // enrolledApproved: PENDING is not enough (combinators.ts:62-65).
              { course: { enrollments: { some: { studentId: actor.id, status: 'APPROVED' } } } },
            ],
          },
        ],
      };
  }
}

/**
 * Visibility AND the caller's filters, never visibility OR them. The filters are
 * collected into separate `AND` terms because `visibilityWhere` already owns the
 * top-level `OR` and a second one would silently replace it — so `?type=VIDEO` can
 * narrow a student's rows and can never widen them past the policy.
 */
function listWhere(actor: Actor | null, query: ListResourcesQuery): Prisma.ResourceWhereInput {
  const filters: Prisma.ResourceWhereInput[] = [visibilityWhere(actor)];

  if (query.courseId !== undefined) filters.push({ courseId: query.courseId });
  if (query.type !== undefined) filters.push({ type: query.type });

  // `isPublic=false` is ignored for anonymous callers, who only ever see public
  // resources: applying it there answers an empty page instead of the shelf they asked
  // for. Same call courses.service.ts:246-250 makes for `?published=false`.
  if (actor !== null && query.isPublic !== undefined) filters.push({ isPublic: query.isPublic });

  if (query.q !== undefined) {
    // v1 substring match, the same shape the course catalogue uses. The trigram indexes
    // in migration 0002 exist for a ranked search, but reaching them needs raw SQL and
    // `Resource` has no `searchVector` column at all.
    filters.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: filters };
}

type SortDirection = ListResourcesQuery['order'];

/**
 * `sort` arrives as free-form text (pagination.ts:16), so it is matched against this
 * whitelist and never interpolated into an `orderBy` key.
 *
 * `createdAt` is the default because `@@index([courseId, createdAt])`
 * (schema.prisma:449) is the index the course-nested list reads, and that is the call
 * the SPA makes on every course-detail view (CourseDetail.tsx:141).
 */
const ORDER_BY: Record<string, (order: SortDirection) => Prisma.ResourceOrderByWithRelationInput> =
  {
    createdAt: (order) => ({ createdAt: order }),
    updatedAt: (order) => ({ updatedAt: order }),
    title: (order) => ({ title: order }),
    type: (order) => ({ type: order }),
  };

const DEFAULT_ORDER = (order: SortDirection): Prisma.ResourceOrderByWithRelationInput => ({
  createdAt: order,
});

/*
/*
 * `hasOwnProperty`, not a bare `ORDER_BY[sort]`, and it is load-bearing rather than
 * pedantic.
 *
 * An object literal inherits from `Object.prototype`, so `ORDER_BY['toString']` is not
 * `undefined` — it is a FUNCTION, which passes the `??` below and is then called with
 * `this` unbound. `Object.prototype.toString` returns a STRING, Prisma is handed
 * `orderBy: '[object Undefined]'`, and an anonymous `GET /resources?sort=toString`
 * answers 500; `?sort=valueOf` throws outright. `__proto__: null` on the table would
 * also close it, but not while the table is typed `Record<string, ...>` — `null` is
 * not assignable to the value type, so the guard lives here.
 *
 * `sort` is free-form text off the query string (pagination.ts:16). The whitelist is
 * the only thing between a caller and that key.
 */
function orderFor(query: ListResourcesQuery): Prisma.ResourceOrderByWithRelationInput {
  const build =
    query.sort !== undefined && Object.prototype.hasOwnProperty.call(ORDER_BY, query.sort)
      ? ORDER_BY[query.sort]
      : undefined;
  return (build ?? DEFAULT_ORDER)(query.order);
}

/**
 * The cross-course list, `GET /resources`.
 *
 * `Actor | null`, because the anonymous row of `resource:read` is `isPublic` and not
 * `deny` (policy.ts:192): a logged-out visitor is a legitimate caller here and gets the
 * public shelf. Seeing that a public resource EXISTS is deliberately wider than
 * `resource:download`, which refuses anonymous outright (policy.ts:217-226).
 */
export async function list(
  actor: Actor | null,
  query: ListResourcesQuery,
): Promise<Paginated<ResourceDto>> {
  const where = listWhere(actor, query);

  const [rows, total] = await prisma.$transaction([
    prisma.resource.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: RESOURCE_INCLUDE,
    }),
    prisma.resource.count({ where }),
  ]);

  return { data: rows.map(toResourceDto), meta: paginationMeta(query.page, query.limit, total) };
}

/**
 * The course-nested list, `GET /courses/:courseId/resources` — the call
 * CourseDetail.tsx:141 makes on every course-detail view. Declared in
 * courses.routes.ts because it lives under the /courses prefix; implemented here
 * because a module boundary and a URL prefix are not the same thing.
 *
 * That route's gate is `course:read`, not `resource:read`, and this narrowing is what
 * makes that safe: a caller who may read the course gets the subset of its resources
 * their own policy row allows, which for a non-enrolled student — and for an anonymous
 * visitor — is the public ones.
 */
export function listForCourse(
  actor: Actor | null,
  courseId: string,
  query: ListResourcesQuery,
): Promise<Paginated<ResourceDto>> {
  // The path segment wins over any `?courseId=` the caller also sent.
  return list(actor, { ...query, courseId });
}

/**
 * One resource, after `authorize('resource:read')` has already accepted the caller.
 *
 * `findFirst` with the soft-delete filter rather than `findUniqueOrThrow`: an ADMIN
 * passes the gate on an id that does not exist (their cell is `allow`, which reads no
 * subject field), so a missing row is a reachable path here and not merely a race — and
 * it has to answer 404 rather than a null-dereference 500.
 */
export async function getById(id: string): Promise<ResourceDto> {
  const resource = await prisma.resource.findFirst({
    where: { id, deletedAt: null, course: { deletedAt: null } },
    include: RESOURCE_INCLUDE,
  });
  if (!resource) throw notFound('Resource');
  return toResourceDto(resource);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** A foreign key the client chose turns a 500 into a field-level 422 (auth.service.ts:167-174). */
async function assertCourseExists(courseId: string): Promise<void> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw validationFailed([{ path: 'courseId', message: 'Unknown course' }]);
}

/**
 * The three things that can be wrong with a client-chosen `uploadId`, checked in one
 * query so each is a 422 with a field path rather than a 500 or a bare 409.
 *
 * The OWNERSHIP check is the same class of rule as `ownsCourse` on `resource:create`:
 * without it a teacher could attach a colleague's private file to their own PUBLIC
 * resource by guessing an id, which is the upload-shaped version of exactly the hole
 * policy.ts:200-201 closes for courses. There is no `upload:attach` action to express it
 * in the policy table (policy.ts:68-69 stops at presign and commit), so the service owns
 * it — and ADMIN is exempt here for the same reason ADMIN is `allow` everywhere else.
 *
 * `Resource.uploadId` is `@unique` (schema.prisma:435), so an upload already spoken for
 * is refused here; two creates racing past this check collide on P2002, which is already
 * a 409 (errors.plugin.ts:46-50) and is deliberately left to be exactly that — the same
 * call enrollments.service.ts:348-350 makes.
 */
async function assertUploadUsable(uploadId: string, actor: Actor): Promise<void> {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { id: true, ownerId: true, resource: { select: { id: true } } },
  });
  if (!upload) throw validationFailed([{ path: 'uploadId', message: 'Unknown upload' }]);
  if (actor.role !== 'ADMIN' && upload.ownerId !== actor.id) {
    throw validationFailed([{ path: 'uploadId', message: 'That upload belongs to someone else' }]);
  }
  if (upload.resource !== null) {
    throw validationFailed([
      { path: 'uploadId', message: 'That upload is already attached to a resource' },
    ]);
  }
}

/**
 * `resource:create` was decided at the route against the COURSE named in the body, so
 * everything that happens here is data shaping.
 *
 * The author is the session, never the body — `createResourceSchema` has no `authorId`
 * (resource.ts:65-75), and accepting one would be a way to forge attribution.
 *
 * No audit row is written by hand: `Resource` is in AUDITED_MODELS (packages/db/src/
 * audit.ts), so the Prisma extension writes it, and a second one here would double every
 * create.
 */
export async function create(actor: Actor, input: CreateResourceInput): Promise<ResourceDto> {
  await assertCourseExists(input.courseId);
  if (input.uploadId) await assertUploadUsable(input.uploadId, actor);

  const resource = await prisma.resource.create({
    data: {
      courseId: input.courseId,
      authorId: actor.id,
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      // `?? null` on both, never `undefined`: the CHECK in migration 0002 counts
      // non-nulls, and `createResourceSchema` has already refused a body that sets
      // neither or both (resource.ts:39-63).
      uploadId: input.uploadId ?? null,
      externalUrl: input.externalUrl ?? null,
      isPublic: input.isPublic,
    },
    include: RESOURCE_INCLUDE,
  });

  return toResourceDto(resource);
}

/**
 * `updateResourceSchema` can move a resource across the CHECK constraint in ways the
 * body alone cannot see, because its refinement only ever reads the SUBMITTED fields
 * while `num_nonnulls("uploadId","externalUrl") = 1` (migration 0002) reads the STORED
 * row. Three patches are legal zod and illegal SQL, and an untranslated constraint
 * violation surfaces as a 500 (errors.plugin.ts:59-60) — so they are refused here with a
 * field path instead. Same reasoning as the date guard at courses.service.ts:444-450.
 */
function assertSourceStaysCoherent(
  current: { uploadId: string | null },
  input: UpdateResourceInput,
): void {
  const hasUpload = current.uploadId !== null;

  if (input.externalUrl === null && !hasUpload) {
    throw validationFailed([
      { path: 'externalUrl', message: 'A link resource must keep its URL. Delete it instead.' },
    ]);
  }
  if (typeof input.externalUrl === 'string' && hasUpload) {
    throw validationFailed([
      { path: 'externalUrl', message: 'This resource is backed by a file, not a link.' },
    ]);
  }
  // resource.ts:56-62 refuses this combination at creation; the stored row deserves the
  // same rule when only `type` is being patched.
  if (input.type === 'LINK' && hasUpload) {
    throw validationFailed([{ path: 'type', message: 'A LINK resource cannot carry an upload.' }]);
  }
}

/**
 * No `actor` parameter, because nothing in an update is actor-scoped. The author never
 * moves (there is no `authorId` in `updateResourceSchema`) and neither does the course —
 * a patch that could re-file a resource into another course would need a SECOND
 * `ownsCourse` check against the destination, which is a shape the policy table does not
 * describe. `resource:update` was already decided against this row's subject at the gate.
 */
export async function update(id: string, input: UpdateResourceInput): Promise<ResourceDto> {
  const current = await prisma.resource.findFirst({
    where: { id, deletedAt: null, course: { deletedAt: null } },
    select: { id: true, uploadId: true },
  });
  if (!current) throw notFound('Resource');

  assertSourceStaysCoherent(current, input);

  const resource = await prisma.resource.update({
    where: { id },
    data: {
      // Keys are spread in or left out entirely: under `exactOptionalPropertyTypes`,
      // `{ title: undefined }` is not assignable to an optional field, and writing it
      // would also overwrite a column the caller never mentioned.
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl } : {}),
    },
    include: RESOURCE_INCLUDE,
  });

  return toResourceDto(resource);
}

/**
 * Soft delete only — schema.prisma:5-7 rule 3, which is why every read in this file
 * filters `deletedAt`. A hard delete would also cascade the row's comments away
 * (schema.prisma:495), and "remove this file from the course" does not mean "erase the
 * discussion about it".
 *
 * The upload behind it is deliberately left alone: `Resource.uploadId` is
 * `onDelete: SetNull` while the CHECK demands exactly one source, so touching the Upload
 * row is the deadlock recorded in NEXT.md:42 and not this endpoint's business.
 */
export async function remove(id: string): Promise<void> {
  const resource = await prisma.resource.findFirst({
    // The same two-level filter every other read here uses, so a row nobody can see is
    // also a row nobody can delete: soft-deleting an already-invisible resource changes
    // nothing and would answer 204 to a caller whose GET answers 404.
    where: { id, deletedAt: null, course: { deletedAt: null } },
    select: { id: true },
  });
  if (!resource) throw notFound('Resource');

  await prisma.resource.update({ where: { id }, data: { deletedAt: new Date() } });
}
