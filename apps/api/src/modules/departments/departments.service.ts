import { prisma, type Prisma } from '@skillwright/db';
import { paginationMeta, slugSchema, toSkipTake } from '@skillwright/shared';
import { toDepartmentSummary } from '../../lib/dto.js';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import type {
  CreateDepartmentInput,
  DepartmentDetail,
  DepartmentSummary,
  ListDepartmentsQuery,
  Paginated,
  UpdateDepartmentInput,
} from './departments.schema.js';

/**
 * No `loadSubject` helper lives here, deliberately.
 *
 * Every cell of the four department rows in `POLICY` (policy.ts:328-354) is a bare
 * `allow` or `deny` — not one of them reads a `Subject` field. A loader would cost a
 * query per request and hand `can()` data no rule consults, so `authorize('department:…')`
 * with no subject loader is the complete gate here. Courses and enrollments, whose
 * rules read `courseTeacherId` and `studentId`, are the ones that need loaders.
 *
 * The same reason is why no function below takes an `Actor`: nothing in this module
 * branches on the caller. The audit trail still names them — the Prisma audit
 * extension reads the actor out of the AsyncLocalStorage that logger.plugin.ts put it
 * in, so a manual audit row here would double-count (auth.service.ts:125-128).
 */

/**
 * `as const` matters: Prisma derives the payload type from the literal shape.
 *
 * `courses` is filtered because soft delete is not enforced by the ORM — `deletedAt`
 * is a plain nullable column (schema.prisma:344), so a removed course would otherwise
 * inflate `courseCount` for as long as the row survives.
 */
const DETAIL_INCLUDE = {
  _count: {
    select: {
      courses: { where: { deletedAt: null } },
      teacherProfiles: true,
      studentProfiles: true,
    },
  },
} as const;

type DepartmentWithCounts = Prisma.DepartmentGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/*
 * `toDepartmentSummary` — the three fields the list envelope carries — is imported
 * from lib/dto.ts. A department summary is nested inside every course summary, so
 * courses and enrollments serialise it as often as this module does.
 */

export function toDepartmentDetail(department: DepartmentWithCounts): DepartmentDetail {
  return {
    ...toDepartmentSummary(department),
    description: department.description,
    courseCount: department._count.courses,
    teacherCount: department._count.teacherProfiles,
    studentCount: department._count.studentProfiles,
    createdAt: department.createdAt.toISOString(),
    updatedAt: department.updatedAt.toISOString(),
  };
}

/**
 * Loads the counts `DepartmentDetail` needs, or 404s.
 *
 * `findFirst` rather than `findUnique` because `deletedAt` is not part of the primary
 * key, and a soft-deleted department must read as absent (auth.service.ts:152-154).
 */
async function loadDepartmentDetail(id: string): Promise<DepartmentWithCounts> {
  const department = await prisma.department.findFirst({
    where: { id, deletedAt: null },
    include: DETAIL_INCLUDE,
  });
  if (!department) throw notFound('Department');
  return department;
}

/**
 * `sort` arrives as a free-form string (pagination.ts:16). Whitelisting it against
 * literal branches is what keeps a caller-chosen key out of `orderBy`; an unrecognised
 * value falls back rather than 422ing, so a stale bookmark still renders a list.
 */
function orderFor(query: ListDepartmentsQuery): Prisma.DepartmentOrderByWithRelationInput {
  switch (query.sort) {
    case 'name':
      return { name: query.order };
    case 'slug':
      return { slug: query.order };
    case 'updatedAt':
      return { updatedAt: query.order };
    default:
      return { createdAt: query.order };
  }
}

function listWhere(query: ListDepartmentsQuery): Prisma.DepartmentWhereInput {
  const where: Prisma.DepartmentWhereInput = { deletedAt: null };
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { slug: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  return where;
}

/**
 * Derives the URL slug the server owns, per department.ts:22-25.
 *
 * NFKD first so an accented letter decomposes into a plain one plus a combining mark;
 * the mark is not alphanumeric, so the same pass that collapses spaces removes it.
 * The result is validated by the caller rather than trusted: a name made entirely of
 * punctuation derives to the empty string, and that has to surface as a field error
 * rather than as a database constraint violation.
 */
function deriveSlug(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function list(query: ListDepartmentsQuery): Promise<Paginated<DepartmentSummary>> {
  const where = listWhere(query);
  const [rows, total] = await prisma.$transaction([
    prisma.department.findMany({ where, ...toSkipTake(query), orderBy: orderFor(query) }),
    prisma.department.count({ where }),
  ]);

  return {
    data: rows.map(toDepartmentSummary),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

export async function get(id: string): Promise<DepartmentDetail> {
  return toDepartmentDetail(await loadDepartmentDetail(id));
}

export async function create(input: CreateDepartmentInput): Promise<DepartmentDetail> {
  // The slug is accepted so a migration can preserve an existing URL, and derived
  // otherwise. Either way it is validated against the shared rule before the insert,
  // which turns an underivable name into a 422 on `slug` instead of a raw write.
  const candidate = input.slug ?? deriveSlug(input.name);
  const slug = slugSchema.safeParse(candidate);
  if (!slug.success) {
    throw validationFailed([
      {
        path: 'slug',
        message: 'Could not derive a URL slug from this name. Send one explicitly.',
      },
    ]);
  }

  // `name` and `slug` are both @unique (schema.prisma:296-297); a collision arrives
  // as P2002, which errors.plugin.ts:47-51 already turns into a 409.
  const department = await prisma.department.create({
    data: {
      name: input.name,
      slug: slug.data,
      ...(input.description === undefined ? {} : { description: input.description }),
    },
    include: DETAIL_INCLUDE,
  });

  return toDepartmentDetail(department);
}

export async function update(id: string, input: UpdateDepartmentInput): Promise<DepartmentDetail> {
  // 404 before the write, because `update` matches on the primary key alone and would
  // happily resurrect a soft-deleted row.
  await loadDepartmentDetail(id);

  // `slug` is absent from `updateDepartmentSchema` by design — URLs are stable — so it
  // is neither read from the body nor re-derived when the name changes.
  const department = await prisma.department.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    },
    include: DETAIL_INCLUDE,
  });

  return toDepartmentDetail(department);
}

export async function remove(id: string): Promise<void> {
  const department = await loadDepartmentDetail(id);

  // Course.departmentId (schema.prisma:318), TeacherProfile.departmentId (:191) and
  // StudentProfile.departmentId (:211) are all `onDelete: Restrict`, and a soft delete
  // trips none of them — which is exactly the trap. Without this guard the rows survive
  // pointing at a department that no longer appears in any list or lookup.
  const attached =
    department._count.courses +
    department._count.teacherProfiles +
    department._count.studentProfiles;
  if (attached > 0) {
    throw conflict('This department still has courses or members');
  }

  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
}
