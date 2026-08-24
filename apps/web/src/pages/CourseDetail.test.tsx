/**
 * Pins the Phase 4 slice on this screen: the syllabus download link in the header.
 *
 * - it exists exactly when the served detail carries a `syllabusUrl`, because that
 *   field is minted server-side (`toCourseDetail`) only while a COMMITTED upload is
 *   attached — presence IS the permission, so no client-side gate wraps it;
 * - its href IS the signed URL — a real download link, not a button that would have
 *   to mint another URL first.
 *
 * Harness as in Announcements.test.tsx: network stubbed at `@/lib/api`, session
 * seeded into the cache, route module mocked down to `Route.useParams`, TanStack
 * `Link` degraded to the anchor it would have produced (the eyebrow back-link needs
 * router context these tests do not mount).
 */
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { CourseDetail } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
}));

/**
 * Hoisted because the route-module factory below reads it: a `vi.mock` factory
 * runs before any `const` in this file, and referencing a not-yet-initialised
 * binding there is a ReferenceError at collection time.
 */
const { COURSE_ID } = vi.hoisted(() => ({
  COURSE_ID: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/courses.$courseId', () => ({
  Route: {
    useParams: () => ({ courseId: COURSE_ID }),
    fullPath: `/courses/${COURSE_ID}`,
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Same degradation as Announcements.test.tsx: href interpolated, no router context.
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { CourseDetailPage } from './CourseDetail.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

const SIGNED_SYLLABUS_URL = 'https://objects.example.test/bucket/syllabi/key?X-Amz-Signature=abc';

const VIEWER: SessionUser = {
  id: STUDENT_ID,
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/**
 * A published course seen by an APPROVED student: the widest ordinary audience for
 * the header, whose policy surface stays quiet — no enrolment button (already
 * approved), no Edit course (denied), so the syllabus link stands alone in the actions.
 */
function course(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: COURSE_ID,
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    description: 'Strikes, beads and safety.',
    department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
    teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    capacity: 12,
    approvedCount: 3,
    seatsRemaining: 9,
    workshopCapacity: null,
    workshopSeatsRemaining: null,
    isFull: false,
    publishedAt: '2026-08-01T09:00:00.000Z',
    startDate: '2026-09-01T09:00:00.000Z',
    endDate: null,
    syllabusUploadId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
    syllabusUrl: SIGNED_SYLLABUS_URL,
    resourceCount: 0,
    viewerEnrollmentStatus: 'APPROVED',
    prerequisiteCourseId: null,
    prerequisite: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage(served: CourseDetail = course()): void {
  apiGet.mockImplementation((path) => {
    if (path === `/courses/${COURSE_ID}`) return Promise.resolve(served);
    // The resources tab's list; everything else this page might ask for is noise.
    return Promise.resolve(EMPTY_PAGE);
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  render(
    <QueryClientProvider client={client}>
      <CourseDetailPage />
    </QueryClientProvider>,
  );
}

describe('CourseDetail header', () => {
  it('offers the syllabus as a real download link straight to the signed URL', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: /download syllabus/i });
    expect(link).toHaveAttribute('href', SIGNED_SYLLABUS_URL);
    // Download semantics, stated on the element itself.
    expect(link).toHaveAttribute('download');
  });

  it('renders nothing where a syllabus would be when there is none', async () => {
    renderPage(course({ syllabusUploadId: null, syllabusUrl: null }));

    // Loaded, not merely pending: the absence must be the loaded answer.
    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    expect(screen.queryByRole('link', { name: /syllabus/i })).toBeNull();
    // And no dead affordance wearing a disabled state either.
    expect(screen.queryByText(/syllabus/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Attendance — Phase 5
// ---------------------------------------------------------------------------

const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';
const OTHER_STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD4';
const TEACHER_USER: SessionUser = {
  id: TEACHER_ID,
  email: 'teacher@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/** The viewer's own APPROVED row, as `GET /enrollments?courseId=…` self-scopes it. */
const OWN_ENROLLMENT = {
  id: ENROLLMENT_ID,
  status: 'APPROVED',
  requestedAt: '2026-08-01T09:00:00.000Z',
  decidedAt: '2026-08-02T09:00:00.000Z',
  decidedBy: null,
  decisionNote: null,
  student: { id: STUDENT_ID, name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
  course: {
    id: COURSE_ID,
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
    teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    capacity: 12,
    approvedCount: 3,
    seatsRemaining: 9,
    workshopCapacity: null,
    workshopSeatsRemaining: null,
    isFull: false,
    publishedAt: '2026-08-01T09:00:00.000Z',
  },
};

/** A second seat on the roster, for the register's teacher-side fixture. */
const ROSTER_PAGE = {
  data: [
    OWN_ENROLLMENT,
    {
      ...OWN_ENROLLMENT,
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD5',
      student: {
        id: OTHER_STUDENT_ID,
        name: 'Ben Ruiz',
        role: 'STUDENT',
        avatarUrl: null,
      },
    },
  ],
  meta: EMPTY_PAGE.meta,
};

const ATTENDANCE_SUMMARY = {
  counts: { present: 4, absent: 1, late: 2 },
  total: 7,
  recent: [
    {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD6',
      enrollmentId: ENROLLMENT_ID,
      sessionDate: '2026-08-21T09:00:00.000Z',
      status: 'LATE',
      note: 'Bus broke down',
      markedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    },
  ],
};

/**
 * The register answers with whatever date it was asked for — the component's own
 * "today" decides that, and no assertion should depend on which day the suite ran.
 */
function attendanceRegister(date: string) {
  return {
    date,
    rows: ROSTER_PAGE.data.map((entry, index) => ({
      enrollmentId: entry.id,
      student: entry.student,
      status: index === 1 ? ('ABSENT' as const) : null,
      note: null,
      markedBy: null,
    })),
  };
}

interface ApiHandlers {
  [path: string]: (path: string, options?: unknown) => unknown;
}

/**
 * The richer harness the attendance tests need: routes by path prefix and serves
 * query-aware answers for the two endpoints whose RESPONSE depends on who asks.
 */
function renderAttendance(
  served: CourseDetail,
  user: SessionUser,
  handlers: ApiHandlers = {},
): void {
  apiGet.mockImplementation((path, options) => {
    const route = Object.keys(handlers).find((key) => path.startsWith(key));
    if (route) return Promise.resolve(handlers[route](path, options));

    if (path === `/courses/${COURSE_ID}`) return Promise.resolve(served);
    return Promise.resolve(EMPTY_PAGE);
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user });
  render(
    <QueryClientProvider client={client}>
      <CourseDetailPage />
    </QueryClientProvider>,
  );
}

describe('CourseDetail attendance — a student looking at their own course', () => {
  it('shows an approved student their own summary below the tabs, never the register', async () => {
    renderAttendance(course(), VIEWER, {
      // Most specific prefix FIRST: both endpoints live under /enrollments.
      [`/enrollments/${ENROLLMENT_ID}/attendance`]: () => ATTENDANCE_SUMMARY,
      '/enrollments': () => ROSTER_PAGE, // self-scoped to their own row server-side
    });

    expect(await screen.findByRole('heading', { name: 'Your attendance' })).toBeInTheDocument();
    expect(await screen.findByText('Recent sessions')).toBeInTheDocument();

    // No mark controls exist for the one role the policy denies outright.
    expect(screen.queryByRole('button', { name: /save register/i })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders nothing new for a student without an APPROVED enrolment', async () => {
    renderAttendance(course({ viewerEnrollmentStatus: 'PENDING' }), VIEWER);

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    expect(screen.queryByText('Your attendance')).toBeNull();
    // And it never asked: no enrolment lookup, no summary request.
    const enrollmentCalls = apiGet.mock.calls.filter(([path]) =>
      String(path).startsWith('/enrollments'),
    );
    expect(enrollmentCalls).toHaveLength(0);
  });
});

describe('CourseDetail attendance — the owning teacher', () => {
  it('serves the register on the Students tab above the approval list', async () => {
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: (_path, options) =>
        attendanceRegister((options as { query?: { date?: string } }).query?.date ?? '1970-01-01'),
    });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
    await userEvent.click(await screen.findByRole('tab', { name: /students/i }));

    expect(await screen.findByText('Attendance register')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Attendance for Ada Okafor' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Attendance for Ben Ruiz' })).toBeInTheDocument();
    // Ben's loaded mark from the fixture is visible before anyone touches a radio.
    expect(
      within(screen.getByRole('group', { name: 'Attendance for Ben Ruiz' })).getByRole('radio', {
        name: 'Absent',
      }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: /save register/i })).toBeEnabled();

    // And the approval list the tab has always had is still underneath.
    expect(await screen.findByText('Enrolled students and requests')).toBeInTheDocument();
  });

  it('offers a non-owning teacher neither the Students tab nor the register', async () => {
    renderAttendance(
      course({
        teacher: { id: OTHER_STUDENT_ID, name: 'Someone Else', role: 'TEACHER', avatarUrl: null },
      }),
      TEACHER_USER,
    );

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    // `enrollment:read` gates the WHOLE tab on `ownsCourse`, so the tab trigger
    // itself is absent — and with it every register affordance.
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /students/i })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('Attendance register')).toBeNull();
    expect(screen.queryByRole('button', { name: /save register/i })).toBeNull();
  });
});
