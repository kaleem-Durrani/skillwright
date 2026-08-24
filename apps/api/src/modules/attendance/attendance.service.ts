import { prisma, type Prisma, type Db } from '@skillwright/db';
import type { Actor, Subject } from '@skillwright/shared';
import { Readable } from 'node:stream';
import { csvStream } from '../../lib/csv.js';
import { toUserSummary } from '../../lib/dto.js';
import { conflict, notFound } from '../../lib/errors.js';
import type {
  AttendanceExportQuery,
  AttendanceRecordDto,
  AttendanceRegisterDto,
  AttendanceSummaryDto,
  MarkRegisterInput,
} from './attendance.schema.js';

/**
 * Interactive-transaction budget for the bulk mark. Generous rather than default
 * for the same reason enrollments.service.ts needs one: the audit extension writes
 * each AuditEvent on a SEPARATE connection from inside the callback, so a register
 * for a full class queues on the pool before it queues on the row lock.
 */
const TX_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;

/** How many recent rows the personal summary ships. A dashboard wants a glance, not a history. */
const SUMMARY_RECENT_TAKE = 10;

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

type AttendanceRecordWithMarker = Prisma.AttendanceRecordGetPayload<{
  include: { markedBy: true };
}>;

export function toAttendanceRecordDto(record: AttendanceRecordWithMarker): AttendanceRecordDto {
  return {
    id: record.id,
    enrollmentId: record.enrollmentId,
    // The DATE column comes back as an instant at UTC midnight; every date in the
    // system crosses the wire as ISO, so it stays one.
    sessionDate: record.sessionDate.toISOString(),
    status: record.status,
    note: record.note,
    markedBy: record.markedBy ? toUserSummary(record.markedBy) : null,
  };
}

/**
 * A bare `YYYY-MM-DD` string is what the wire carries; UTC midnight is what the
 * DATE column stores. Spelled out rather than `new Date(s)` so nobody has to
 * recall that the bare form already parses as UTC.
 */
function toSessionDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Subject loaders — the only database access authorization performs
//
// Two shapes, exactly like the enrollment module owns two loaders: marking and
// reading a whole register act on the COURSE, while a personal summary acts on
// the ENROLLMENT row. They duplicate their enrollments.service.ts cousins on
// purpose — the module that declares the route owns its gate.
// ---------------------------------------------------------------------------

/** Subject for `attendance:mark` and the course-scoped half of `attendance:read`. */
export async function loadCourseSubject(courseId: string): Promise<Subject | undefined> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, teacherId: true },
  });
  if (!course) return undefined;

  return { id: course.id, courseId: course.id, courseTeacherId: course.teacherId };
}

/** Subject for the enrollment-scoped half of `attendance:read` — the own summary. */
export async function loadEnrollmentSubject(id: string): Promise<Subject | undefined> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, course: { deletedAt: null } },
    select: { id: true, studentId: true, courseId: true, course: { select: { teacherId: true } } },
  });
  if (!enrollment) return undefined;

  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    courseId: enrollment.courseId,
    courseTeacherId: enrollment.course.teacherId,
  };
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

const ROSTER_SELECT = { id: true, student: true } as const;

/**
 * The two delegates a register read touches. Satisfied by the plain client and by
 * an interactive transaction's `tx` alike — naming the narrow shape avoids
 * wrestling Prisma's extended-transaction types into a union.
 */
type RegisterClient = Pick<Db, 'enrollment' | 'attendanceRecord'>;

/** Roster rows ordered by student name, so both reads are deterministic. */
function rosterOrderBy(): Prisma.EnrollmentOrderByWithRelationInput {
  return { student: { name: 'asc' } };
}

/**
 * One date's register for a course: the current APPROVED roster joined with any
 * existing records. Deliberately DATE-SCOPED — see migration 0004's caveat.
 * An unmarked seat is `status: null`, not an absent row.
 */
async function buildRegister(
  client: RegisterClient,
  courseId: string,
  date: string,
): Promise<AttendanceRegisterDto> {
  const sessionDate = toSessionDate(date);

  const roster = await client.enrollment.findMany({
    where: { courseId, status: 'APPROVED' },
    select: ROSTER_SELECT,
    orderBy: rosterOrderBy(),
  });

  const records = await client.attendanceRecord.findMany({
    where: { sessionDate, enrollmentId: { in: roster.map((row) => row.id) } },
    include: { markedBy: true },
  });
  const byEnrollment = new Map(records.map((record) => [record.enrollmentId, record]));

  return {
    date,
    rows: roster.map((row) => {
      const record = byEnrollment.get(row.id);
      return {
        enrollmentId: row.id,
        student: toUserSummary(row.student),
        status: record?.status ?? null,
        note: record?.note ?? null,
        markedBy: record?.markedBy ? toUserSummary(record.markedBy) : null,
      };
    }),
  };
}

/**
 * Marks a whole register in one transaction. Any enrollmentId that is not an
 * APPROVED enrollment of THIS course — unknown, another teacher's course,
 * PENDING, REJECTED, WITHDRAWN — aborts the WHOLE request with a 409 before a
 * single row is written: a partially-saved register is worse than a rejected
 * one, because the instructor believes they saved.
 *
 * 409 CONFLICT, not 422: the request shape is valid and every id may exist —
 * what conflicts is roster STATE, the same reason `enrollment:approve` answers
 * 409 on an ineligible transition. Documented as the module convention here.
 *
 * Upserts ride `@@unique([enrollmentId, sessionDate])`, so re-saving a date
 * corrects statuses instead of duplicating rows; omitting `note` preserves the
 * existing one. Each upsert passes through the audit extension, which writes a
 * CREATE or a diffed UPDATE per row.
 */
export async function markRegister(
  actor: Actor,
  courseId: string,
  input: MarkRegisterInput,
): Promise<AttendanceRegisterDto> {
  return prisma.$transaction(async (tx) => {
    // Reaching here means loadCourseSubject found the course; this re-read is
    // the roster, not a second existence check.
    const approved = await tx.enrollment.findMany({
      where: { courseId, status: 'APPROVED' },
      select: { id: true },
    });
    const seatedIds = new Set(approved.map((row) => row.id));

    const ineligible = input.marks.filter((mark) => !seatedIds.has(mark.enrollmentId));
    if (ineligible.length > 0) {
      const first = ineligible[0];
      throw conflict(
        `${ineligible.length} of ${input.marks.length} enrollmentIds ${ineligible.length === 1 ? 'is' : 'are'} not APPROVED enrolments on this course${first ? ` (first: ${first.enrollmentId})` : ''}`,
      );
    }

    const sessionDate = toSessionDate(input.date);
    for (const mark of input.marks) {
      await tx.attendanceRecord.upsert({
        where: { enrollmentId_sessionDate: { enrollmentId: mark.enrollmentId, sessionDate } },
        create: {
          enrollmentId: mark.enrollmentId,
          sessionDate,
          status: mark.status,
          markedById: actor.id,
          ...(mark.note !== undefined ? { note: mark.note } : {}),
        },
        update: {
          status: mark.status,
          markedById: actor.id,
          ...(mark.note !== undefined ? { note: mark.note } : {}),
        },
      });
    }

    return buildRegister(tx, courseId, input.date);
  }, TX_OPTIONS);
}

/**
 * Read side of `GET /courses/:courseId/attendance?date=`.
 *
 * The course is re-checked by hand because `attendance:read`'s ADMIN cell is
 * `allow`, which ignores the subject entirely — an admin naming a missing course
 * reaches this function, and an empty register must never masquerade as a real
 * one. Same post-gate 404 as enrollments.service.ts getById.
 */
export async function registerForDate(
  courseId: string,
  date: string,
): Promise<AttendanceRegisterDto> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw notFound('Course');
  return buildRegister(prisma, courseId, date);
}

// ---------------------------------------------------------------------------
// Personal summary
// ---------------------------------------------------------------------------

/**
 * Counts by status plus the most recent rows, for the student's own dashboard.
 * History spans every intake recorded on this enrollment row — the conflation
 * migration 0004 accepts deliberately.
 */
export async function summaryForEnrollment(enrollmentId: string): Promise<AttendanceSummaryDto> {
  const [grouped, recent] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { enrollmentId },
    }),
    prisma.attendanceRecord.findMany({
      where: { enrollmentId },
      orderBy: { sessionDate: 'desc' },
      take: SUMMARY_RECENT_TAKE,
      include: { markedBy: true },
    }),
  ]);

  const counts = { present: 0, absent: 0, late: 0 };
  let total = 0;
  for (const bucket of grouped) {
    counts[bucket.status.toLowerCase() as keyof typeof counts] += bucket._count._all;
    total += bucket._count._all;
  }

  return { counts, total, recent: recent.map(toAttendanceRecordDto) };
}

// ---------------------------------------------------------------------------
// The register export (Phase 8)
// ---------------------------------------------------------------------------

/** How many records one batched query loads while streaming (lib/csv.ts pulls lazily). */
const EXPORT_BATCH = 500;

/**
 * The attendance register over a date range, `GET /courses/:courseId/attendance/export`.
 *
 * The gate is the ONE the whole module reads a course register through —
 * `attendance:read` with `loadCourseSubject`, exactly as `registerForDate` above — so
 * the export can never serve a row a single-day read would refuse. What is new is
 * only the range: both ends are inclusive and either may be omitted, which reads as
 * "everything recorded" on that side.
 *
 * Rows are the RECORDS, not roster × dates: an unmarked seat has no row to export,
 * and synthesising one for every day of the range would fabricate data the accreditor
 * would file as fact. Ordered by session date then student name, with `{ id: 'asc' }`
 * as the tiebreaker that makes each batched page deterministic.
 */
async function* attendanceExportRows(
  courseId: string,
  query: AttendanceExportQuery,
): AsyncGenerator<readonly (string | null)[]> {
  yield [
    'session_date',
    'student_name',
    'student_id',
    'status',
    'note',
    'marked_by',
    'enrollment_id',
  ];

  const where: Prisma.AttendanceRecordWhereInput = {
    // The course scope rides the relation, so a record from another course's
    // enrollment can never slip in through a guessed id.
    enrollment: { courseId },
    ...(query.from !== undefined || query.to !== undefined
      ? {
          sessionDate: {
            ...(query.from !== undefined ? { gte: toSessionDate(query.from) } : {}),
            ...(query.to !== undefined ? { lte: toSessionDate(query.to) } : {}),
          },
        }
      : {}),
  };

  for (let skip = 0; ; skip += EXPORT_BATCH) {
    const rows = await prisma.attendanceRecord.findMany({
      where,
      orderBy: [{ sessionDate: 'asc' }, { id: 'asc' }],
      skip,
      take: EXPORT_BATCH,
      include: { enrollment: { include: { student: true } }, markedBy: true },
    });

    for (const row of rows) {
      yield [
        // A session date is a DAY (the DATE column stores UTC midnight); the register
        // speaks days, so the bare form goes in the file rather than the instant.
        row.sessionDate.toISOString().slice(0, 10),
        row.enrollment.student.name,
        row.enrollment.student.id,
        row.status,
        row.note,
        row.markedBy?.name ?? '',
        row.enrollmentId,
      ];
    }
    if (rows.length < EXPORT_BATCH) return;
  }
}

/**
 * Streams the export after the same post-gate 404 `registerForDate` performs:
 * `attendance:read`'s ADMIN cell is `allow`, which ignores the subject entirely, so an
 * admin naming a missing course reaches this function and an empty CSV must never
 * masquerade as a real course's register.
 */
export async function exportRegister(
  courseId: string,
  query: AttendanceExportQuery,
): Promise<Readable> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) throw notFound('Course');
  return csvStream(attendanceExportRows(courseId, query));
}
