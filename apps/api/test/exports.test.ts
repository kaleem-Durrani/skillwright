import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// app.ts: "Anything that holds an instance built here — main.ts, the integration
// tests — should name this type. Plain FastifyInstance is a type error, not a widening."
import type { AppInstance } from '../src/app.js';
import type { Role } from '@skillwright/shared';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
  testOutbox,
} from './setup.js';

const PASSWORD = 'correct-horse-battery-staple';

let app: AppInstance;
let departmentId: string;
let sequence = 0;

/**
 * Same unwinding duty as enrollments.test.ts: Course holds Restrict foreign keys to
 * User and Department, so academic rows left behind would break the NEXT file's
 * `resetDatabase()`. AttendanceRecord cascades with its Enrollment.
 */
async function clearAcademicRows(): Promise<void> {
  await prisma.attendanceRecord.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.course.deleteMany({});
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await clearAcademicRows();
  await app.close();
});

beforeEach(async () => {
  await clearAcademicRows();
  await resetDatabase();
  await resetRateLimits(app.redis);
  // resetDatabase()'s own deletes write audit rows (User/Department are audited
  // models); the export tests below read the feed's CONTENTS, so they start clear.
  await prisma.auditEvent.deleteMany({});
  departmentId = await createDepartment();
});

// --- helpers ---------------------------------------------------------------

function authPost(url: string, payload: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/auth${url}`,
    headers: { ...originHeaders },
    payload: payload as Record<string, unknown>,
  });
}

/** Registration makes STUDENTS only; a teacher/admin fixture is promoted on the row. */
async function signIn(email: string, role: Role, name = 'Test Person'): Promise<Person> {
  expect(
    (await authPost('/register', { email, password: PASSWORD, name, departmentId })).statusCode,
  ).toBe(202);

  const code = testOutbox.lastCodeFor(email);
  expect((await authPost('/verify-email', { email, code })).statusCode).toBe(200);

  const user = await prisma.user.update({ where: { email }, data: { role } });

  const login = await authPost('/login', { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  const token = sessionCookie(login);
  expect(token).toBeTruthy();

  return { id: user.id, token: token as string };
}

interface Person {
  id: string;
  token: string;
}

async function makeCourse(
  teacherId: string,
  options: { capacity?: number; published?: boolean; name?: string } = {},
): Promise<string> {
  sequence += 1;
  const course = await prisma.course.create({
    data: {
      code: `WELD-${1000 + sequence}`,
      slug: `welding-${sequence}`,
      name: options.name ?? `Welding ${sequence}`,
      departmentId,
      teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      capacity: options.capacity ?? 10,
      publishedAt: options.published === false ? null : new Date(),
    },
  });
  return course.id;
}

/**
 * An APPROVED enrollment written directly, so each fixture controls requestedAt /
 * decisionNote exactly — the CSV assertions below depend on both.
 */
async function seatStudent(
  courseId: string,
  studentId: string,
  options: {
    requestedAt?: Date;
    decidedAt?: Date;
    decidedById?: string;
    note?: string;
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  } = {},
): Promise<string> {
  const row = await prisma.enrollment.create({
    data: {
      courseId,
      studentId,
      status: options.status ?? 'APPROVED',
      requestedAt: options.requestedAt ?? new Date(),
      ...(options.decidedAt !== undefined ? { decidedAt: options.decidedAt } : {}),
      ...(options.decidedById !== undefined ? { decidedById: options.decidedById } : {}),
      ...(options.note !== undefined ? { decisionNote: options.note } : {}),
    },
  });
  return row.id;
}

/**
 * A minimal RFC 4180 parser, for ASSERTIONS ONLY. It exists because the point of the
 * quoting tests is that the bytes on the wire decode back to the field that was
 * stored — commas, doubled quotes, embedded newlines and all. Splitting on '\n'
 * would make every one of those tests pass vacuously against a broken writer.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// GET /enrollments/export
// ---------------------------------------------------------------------------

describe('GET /enrollments/export', () => {
  it('streams the register: header row, requestedAt order, RFC 4180 quoting of a hostile note', async () => {
    const teacher = await signIn('teacher@example.com', 'TEACHER', 'Tessa Teacher');
    const courseId = await makeCourse(teacher.id);
    const ada = await signIn('ada@example.com', 'STUDENT', 'Ada Okafor');
    const ben = await signIn('ben@example.com', 'STUDENT', 'Ben Ruiz');

    // The note carries everything a naive writer mangles: a comma, doubled quotes
    // and an embedded newline. The raw-body assertion below proves the doubling;
    // the parsed assertion proves it decodes back.
    const hostileNote = 'Seated after "appeal", panel split\non whether prior hours count';
    await seatStudent(courseId, ben.id, {
      requestedAt: new Date('2026-01-02T09:00:00.000Z'),
      status: 'PENDING',
    });
    const seatedId = await seatStudent(courseId, ada.id, {
      requestedAt: new Date('2026-01-01T09:00:00.000Z'),
      decidedAt: new Date('2026-01-03T10:00:00.000Z'),
      decidedById: teacher.id,
      note: hostileNote,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/enrollments/export?courseId=${courseId}&sort=requestedAt&order=asc`,
      headers: { cookie: cookieHeader(teacher.token) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toContain(
      `attachment; filename="enrollments-${courseId}.csv"`,
    );

    // The comma and the newline must each sit INSIDE the quoted field, and the
    // quotes themselves doubled — visible here in the raw bytes, not just in a parse.
    expect(response.body).toContain('"Seated after ""appeal"", panel split');

    const rows = parseCsv(response.body);
    expect(rows[0]).toEqual([
      'enrollment_id',
      'status',
      'student_name',
      'student_id',
      'course_code',
      'course_name',
      'requested_at',
      'decided_at',
      'decided_by',
      'decision_note',
    ]);
    expect(rows).toHaveLength(3);

    const [first, second] = rows.slice(1);
    // Order follows ?sort=requestedAt&order=asc — the LIST's own ordering contract.
    expect(first?.[0]).toBe(seatedId);
    expect(first?.slice(1, 6)).toEqual([
      'APPROVED',
      'Ada Okafor',
      ada.id,
      expect.any(String),
      expect.any(String),
    ]);
    // The hostile note round-trips byte-for-byte through quote-doubling.
    expect(first?.[9]).toBe(hostileNote);

    expect(second?.[2]).toBe('Ben Ruiz');
    expect(second?.[1]).toBe('PENDING');
    expect(second?.[7]).toBe('');
    expect(second?.[9]).toBe('');
  });

  it('narrows a student to their own rows, exactly as the list does', async () => {
    const teacher = await signIn('teacher-own@example.com', 'TEACHER');
    const courseId = await makeCourse(teacher.id);
    const ada = await signIn('ada-own@example.com', 'STUDENT', 'Ada Okafor');
    const ben = await signIn('ben-own@example.com', 'STUDENT', 'Ben Ruiz');
    await seatStudent(courseId, ada.id);
    await seatStudent(courseId, ben.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/enrollments/export?courseId=${courseId}`,
      headers: { cookie: cookieHeader(ada.token) },
    });

    expect(response.statusCode).toBe(200);
    const rows = parseCsv(response.body);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[2]).toBe('Ada Okafor');
  });

  it('serves another teacher an EMPTY register for a course they do not own', async () => {
    const teacherA = await signIn('owner@example.com', 'TEACHER', 'Ada Owner');
    const courseId = await makeCourse(teacherA.id);
    const student = await signIn('enrolled@example.com', 'STUDENT');
    await seatStudent(courseId, student.id);

    const teacherB = await signIn('other@example.com', 'TEACHER', 'Ben Other');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/enrollments/export?courseId=${courseId}`,
      headers: { cookie: cookieHeader(teacherB.token) },
    });

    // This endpoint mirrors the CROSS-COURSE list (`GET /enrollments?courseId=`),
    // whose gate is authentication plus the visibility WHERE — not a subject 403.
    // The refusal is therefore at ROW level: teacher B is answered, but the file
    // holds nothing of teacher A's. A misleading empty register beats a leaked one;
    // the subject-gated exports (attendance below) 403 instead.
    expect(response.statusCode).toBe(200);
    expect(parseCsv(response.body)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// GET /courses/:courseId/attendance/export
// ---------------------------------------------------------------------------

describe('GET /courses/:courseId/attendance/export', () => {
  async function fixtures(): Promise<{
    course: string;
    teacher: Person;
    ada: Person;
    ben: Person;
  }> {
    const teacher = await signIn('marking@example.com', 'TEACHER', 'Dana Marker');
    const courseId = await makeCourse(teacher.id);
    const ada = await signIn('ada-mark@example.com', 'STUDENT', 'Ada Okafor');
    const ben = await signIn('ben-mark@example.com', 'STUDENT', 'Ben Ruiz');
    const adaEnrollment = await seatStudent(courseId, ada.id);
    const benEnrollment = await seatStudent(courseId, ben.id);

    // Three sessions spanning five days; records inserted directly so the range
    // assertions control the dates exactly. Marked-by names the teacher.
    const day = (n: number) => new Date(`2026-03-0${n}T00:00:00.000Z`);
    await prisma.attendanceRecord.createMany({
      data: [
        {
          enrollmentId: adaEnrollment,
          sessionDate: day(1),
          status: 'PRESENT',
          markedById: teacher.id,
        },
        {
          enrollmentId: benEnrollment,
          sessionDate: day(3),
          status: 'ABSENT',
          markedById: teacher.id,
        },
        {
          enrollmentId: adaEnrollment,
          sessionDate: day(6),
          status: 'LATE',
          markedById: teacher.id,
        },
      ],
    });
    return { course: courseId, teacher, ada, ben };
  }

  it('streams the register over a range, ordered by date then student name', async () => {
    const { course, teacher } = await fixtures();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${course}/attendance/export?from=2026-03-02&to=2026-03-06`,
      headers: { cookie: cookieHeader(teacher.token) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toContain(
      `attachment; filename="attendance-${course}-2026-03-02-to-2026-03-06.csv"`,
    );

    const rows = parseCsv(response.body);
    expect(rows[0]).toEqual([
      'session_date',
      'student_name',
      'student_id',
      'status',
      'note',
      'marked_by',
      'enrollment_id',
    ]);
    // Both bounds are inclusive: March 1 is excluded by `from`, March 3 and 6 are in.
    expect(rows.slice(1).map((row) => [row[0], row[1], row[3]])).toEqual([
      ['2026-03-03', 'Ben Ruiz', 'ABSENT'],
      ['2026-03-06', 'Ada Okafor', 'LATE'],
    ]);
  });

  it('exports the whole register when no range is given', async () => {
    const { course, teacher } = await fixtures();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${course}/attendance/export`,
      headers: { cookie: cookieHeader(teacher.token) },
    });

    expect(response.statusCode).toBe(200);
    expect(parseCsv(response.body)).toHaveLength(4);
  });

  it('refuses a teacher who does not own the course — the single-date read’s gate', async () => {
    const { course } = await fixtures();
    const other = await signIn('intruder@example.com', 'TEACHER', 'Nina Intruder');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${course}/attendance/export`,
      headers: { cookie: cookieHeader(other.token) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });

  it('refuses even an enrolled student — the COURSE-shaped subject denies them', async () => {
    const { course, ada } = await fixtures();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/courses/${course}/attendance/export`,
      headers: { cookie: cookieHeader(ada.token) },
    });

    expect(response.statusCode).toBe(403);
  });

  it('404s a missing course for an admin instead of streaming an empty file', async () => {
    const admin = await signIn('dean@example.com', 'ADMIN');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/courses/01JGXDFAM0K2Z1GYCSNM5F5RCX/attendance/export',
      headers: { cookie: cookieHeader(admin.token) },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /audit-events/export
// ---------------------------------------------------------------------------

describe('GET /audit-events/export', () => {
  async function seedEvent(event: {
    // Prisma's AuditAction union, narrowed to what this suite uses — a free-text
    // `action` would not compile against the create call below.
    action?: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'SUSPEND' | 'APPROVE';
    entityType?: string;
    createdAt?: Date;
    actorId?: string | null;
  }): Promise<void> {
    await prisma.auditEvent.create({
      data: {
        action: event.action ?? 'CREATE',
        entityType: event.entityType ?? 'Course',
        entityId: 'cmsvme3r703ucw4g0i6oyh6fh',
        ...(event.actorId !== undefined ? { actorId: event.actorId } : {}),
        ...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
        // Forensics exist on these rows ON PURPOSE: their absence from the FILE is
        // what proves the CSV exports the feed's columns, not the detail's.
        before: { name: 'Before' },
        after: { name: 'After' },
        ip: '203.0.113.9',
        userAgent: 'vitest',
        requestId: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
      },
    });
  }

  it('streams the feed newest-first with exactly the list DTO’s columns', async () => {
    const admin = await signIn('clerk@example.com', 'ADMIN', 'Ada Clerk');
    // The login above is itself audited; this assertion reads CONTENTS, so the feed
    // starts empty once the fixtures exist (audit.test.ts's clearAudit argument).
    await prisma.auditEvent.deleteMany({});
    await seedEvent({ entityType: 'Course', createdAt: new Date('2026-05-01T00:00:00.000Z') });
    await seedEvent({
      action: 'SUSPEND',
      entityType: 'User',
      createdAt: new Date('2026-05-03T00:00:00.000Z'),
    });
    await seedEvent({ entityType: 'Department', createdAt: new Date('2026-05-02T00:00:00.000Z') });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export',
      headers: { cookie: cookieHeader(admin.token) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="audit-events.csv"',
    );

    const rows = parseCsv(response.body);
    expect(rows[0]).toEqual([
      'id',
      'action',
      'entity_type',
      'entity_id',
      'actor_id',
      'actor_name',
      'recorded_at',
    ]);
    expect(rows.map((row) => row[2]).slice(1)).toEqual(['User', 'Department', 'Course']);
    expect(rows).toHaveLength(4);
  });

  it('honours the feed’s filters', async () => {
    const admin = await signIn('filter-clerk@example.com', 'ADMIN');
    await seedEvent({ action: 'SUSPEND', entityType: 'User' });
    await seedEvent({ entityType: 'Course' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export?action=SUSPEND',
      headers: { cookie: cookieHeader(admin.token) },
    });

    const rows = parseCsv(response.body);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe('SUSPEND');
  });

  it('refuses an anonymous caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/audit-events/export' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
  });

  it('refuses a student, naming the rule that denied it', async () => {
    const student = await signIn('no-register@example.com', 'STUDENT');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export',
      headers: { cookie: cookieHeader(student.token) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: STUDENT:deny');
  });

  it('refuses a teacher too — the feed is admin-only in full', async () => {
    const teacher = await signIn('no-file@example.com', 'TEACHER');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/export',
      headers: { cookie: cookieHeader(teacher.token) },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toContain('rule: TEACHER:deny');
  });
});
