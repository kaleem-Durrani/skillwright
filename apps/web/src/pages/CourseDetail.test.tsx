/**
 * Pins the course screen against the Phase 9 wire: the syllabus download link in
 * the header, the INTAKES section (per-intake enrol affordances naming their
 * `offeringId`, refusals shown rather than hidden), and the Students tab whose
 * register is PER INTAKE — selected when a course runs several.
 *
 * - the syllabus link exists exactly when the served detail carries a
 *   `syllabusUrl`, because that field is minted server-side (`toCourseDetail`) only
 *   while a COMMITTED upload is attached — presence IS the permission;
 * - every application names its intake: since Phase 9 the POST refuses a bodyless
 *   request, so "apply to the course" no longer exists anywhere in the UI;
 * - the register reads and writes ONE intake, chosen by the tab's selector when
 *   there is more than one, defaulting to the soonest live one.
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
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';
import type { CourseDetail } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
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
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
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
// Mounted beside the page so the toast store's output is assertable: the capacity
// refusals below speak through `toast()`, which renders nothing without a Toaster.
import { Toaster } from '@/components/ui/Toast';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
/** The rung `WELD-101` names in the Phase 6 tests below. */
const RUNG_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD9';
/** The default (autumn) intake, and a second (spring) one for the selector tests. */
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD7';
const OTHER_OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD8';

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

/** One scheduled run of the course — dates and guarded numbers live HERE now. */
function offering(overrides: Partial<CourseDetail['offerings'][number]> = {}) {
  return {
    id: OFFERING_ID,
    startDate: '2026-09-01T09:00:00.000Z',
    endDate: null,
    capacity: 12,
    workshopCapacity: null,
    approvedCount: 3,
    seatsRemaining: 9,
    isFull: false,
    workshopSeatsRemaining: null,
    viewerEnrollmentStatus: null,
    ...overrides,
  };
}

/**
 * A published course seen by an APPROVED student: the widest ordinary audience for
 * the header, whose policy surface stays quiet — no Edit course (denied), so the
 * syllabus link stands alone in the actions. Their seat shows on the autumn intake
 * itself, where the per-intake chip lives since Phase 9.
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
    publishedAt: '2026-08-01T09:00:00.000Z',
    syllabusUploadId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
    syllabusUrl: SIGNED_SYLLABUS_URL,
    resourceCount: 0,
    prerequisiteCourseId: null,
    prerequisite: null,
    offerings: [offering({ viewerEnrollmentStatus: 'APPROVED' })],
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
      <Toaster />
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
// Intakes — Phase 9: per-intake facts, statuses and applications
// ---------------------------------------------------------------------------

describe('CourseDetail intakes — reading and applying', () => {
  it('renders the intake with its facts beside the viewer’s own status chip', async () => {
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    // Seats are the intake's, not a template capacity — and their APPROVED seat on
    // this intake shows as the chip instead of any button.
    expect(screen.getByText(/of 12 places left/)).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request seat/i })).toBeNull();
  });

  it('sends the offeringId when the student applies to an open intake', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderPage(course({ offerings: [offering()] }));

    await user.click(await screen.findByRole('button', { name: 'Request seat' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/courses/${COURSE_ID}/enrollments`);
    // The whole point of Phase 9: an application NAMES its intake.
    expect(body).toEqual({ offeringId: OFFERING_ID });
  });

  it('keeps a full intake visible but disabled, naming the state', async () => {
    const user = userEvent.setup();
    renderPage(
      course({
        offerings: [
          offering(),
          // A second, full intake: the chip row above keeps its seat, this one refuses.
          offering({ id: OTHER_OFFERING_ID, isFull: true, seatsRemaining: 0, approvedCount: 12 }),
        ],
      }),
    );

    const buttons = await screen.findAllByRole('button', { name: /this intake is full/i });
    expect(buttons[0]).toBeDisabled();

    // Disabled performs nothing even if forced.
    await user.click(buttons[0] as HTMLElement);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('names the exhausted WORKSHOP on the intake that ran out of places', async () => {
    renderPage(
      course({
        offerings: [offering({ workshopCapacity: 5, workshopSeatsRemaining: 0 })],
      }),
    );

    const button = await screen.findByRole('button', { name: /workshop is full/i });
    expect(button).toBeDisabled();
    // The facts line says the same thing the button does.
    expect(screen.getByText('Workshop full')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Attendance — Phase 5, now per intake
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
    publishedAt: '2026-08-01T09:00:00.000Z',
  },
  // The intake the seat belongs to.
  offering: offering(),
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

/**
 * The spring intake never held anyone but Ben.
 *
 * Selected by WHO is on the roster rather than by position: `ROSTER_PAGE.data[1]` meant
 * the same thing right up until someone reordered the fixture, and it told the type
 * checker `| undefined` while telling the reader nothing.
 */
function springRosterRows(): typeof ROSTER_PAGE.data {
  return ROSTER_PAGE.data.filter((row) => row.student.id === OTHER_STUDENT_ID);
}

/** One PENDING request on the FULL-workshop intake, for the decision tests below. */
const PENDING_PAGE = {
  data: [
    {
      ...OWN_ENROLLMENT,
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD8',
      status: 'PENDING',
      decidedAt: null,
      offering: offering({ workshopCapacity: 5, workshopSeatsRemaining: 0 }),
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
 * The register answers with whatever date AND intake it was asked for — the page's
 * selection decides the latter, and no assertion should depend on which day the
 * suite ran.
 */
function attendanceRegister(date: string, offeringRows = ROSTER_PAGE.data) {
  return {
    date,
    rows: offeringRows.map((entry, index) => ({
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
    const handler = route === undefined ? undefined : handlers[route];
    if (handler) return Promise.resolve(handler(path, options));

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
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('CourseDetail attendance — a student looking at their own course', () => {
  it('shows an approved student their own summary below the tabs, never the register', async () => {
    renderAttendance(course(), VIEWER, {
      // Most specific prefix FIRST: both endpoints live under /enrollments.
      [`/enrollments/${ENROLLMENT_ID}/attendance`]: () => ATTENDANCE_SUMMARY,
      '/enrollments': () => ({ data: [OWN_ENROLLMENT], meta: EMPTY_PAGE.meta }), // self-scoped server-side
    });

    expect(await screen.findByRole('heading', { name: 'Your attendance' })).toBeInTheDocument();
    expect(await screen.findByText('Recent sessions')).toBeInTheDocument();

    // No mark controls exist for the one role the policy denies outright.
    expect(screen.queryByRole('button', { name: /save register/i })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders nothing new for a student without an APPROVED enrolment', async () => {
    renderAttendance(
      course({ offerings: [offering({ viewerEnrollmentStatus: 'PENDING' })] }),
      VIEWER,
      {
        [`/enrollments/${ENROLLMENT_ID}/attendance`]: () => ATTENDANCE_SUMMARY,
      },
    );

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    expect(screen.queryByText('Your attendance')).toBeNull();
    // And it never asked for a summary: the completed-rungs lookup may run (every
    // intake's enrol button reads it now), but not this private-by-shape endpoint.
    await waitFor(() => {
      const calls = apiGet.mock.calls.filter(([path]) =>
        String(path).startsWith(`/enrollments/${ENROLLMENT_ID}/attendance`),
      );
      expect(calls).toHaveLength(0);
    });
  });
});

describe('CourseDetail attendance — the owning teacher', () => {
  it('serves the register for the SELECTED intake, above the approval list', async () => {
    let askedOfferingId: string | undefined;
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
        const query = (options as { query?: { date?: string; offeringId?: string } }).query ?? {};
        askedOfferingId = query.offeringId;
        return attendanceRegister(query.date ?? '1970-01-01');
      },
    });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
    await userEvent.click(await screen.findByRole('tab', { name: /students/i }));

    expect(await screen.findByText('Attendance register')).toBeInTheDocument();
    // One intake on the course: no selector, and the register names ITS offeringId.
    expect(screen.queryByRole('combobox', { name: /^intake$/i })).toBeNull();
    await waitFor(() => expect(askedOfferingId).toBe(OFFERING_ID));
    expect(screen.getByRole('group', { name: 'Attendance for Ada Okafor' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Attendance for Ben Ruiz' })).toBeInTheDocument();
    // Ben's loaded mark from the fixture is visible before anyone touches a radio.
    expect(
      within(screen.getByRole('group', { name: 'Attendance for Ben Ruiz' })).getByRole('radio', {
        name: 'Absent',
      }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: /save register/i })).toBeEnabled();

    // And the approval list the tab has always had is still underneath. Its
    // accessible name comes from `DataTable`'s `caption` prop — `aria-label` on
    // the card branch's <ul> (jsdom's stubbed matchMedia never matches `md`, per
    // vitest.setup.ts, so this is the branch that mounts), not visible text, so
    // the query is by role/name rather than `findByText`.
    expect(
      await screen.findByRole('list', { name: 'Enrolled students and requests' }),
    ).toBeInTheDocument();
  });

  it('switches intakes with the selector and refetches THAT intake’s register', async () => {
    const user = userEvent.setup();
    renderAttendance(
      course({
        offerings: [
          offering(),
          offering({
            id: OTHER_OFFERING_ID,
            startDate: '2027-01-10T09:00:00.000Z',
            capacity: 8,
            seatsRemaining: 2,
            approvedCount: 6,
          }),
        ],
      }),
      TEACHER_USER,
      {
        [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
        [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
          const query = (options as { query?: { date?: string; offeringId?: string } }).query ?? {};
          // Two intakes, two rosters — the spring one only ever held Ben.
          return attendanceRegister(
            query.date ?? '1970-01-01',
            query.offeringId === OTHER_OFFERING_ID ? springRosterRows() : ROSTER_PAGE.data,
          );
        },
      },
    );

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
    await user.click(await screen.findByRole('tab', { name: /students/i }));
    await screen.findByText('Attendance register');

    // Default = the soonest live intake: autumn's roster, Ada included.
    expect(
      await screen.findByRole('group', { name: 'Attendance for Ada Okafor' }),
    ).toBeInTheDocument();

    await chooseOption(user, screen.getByRole('combobox', { name: /^intake$/i }), /2027/);

    // Spring's register replaced autumn's — Ben without Ada, under the new offeringId.
    expect(
      await screen.findByRole('group', { name: 'Attendance for Ben Ruiz' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Attendance for Ada Okafor' }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      const calls = apiGet.mock.calls.filter(
        ([path]) => String(path) === `/courses/${COURSE_ID}/attendance`,
      );
      const last = calls[calls.length - 1]?.[1] as { query?: { offeringId?: string } } | undefined;
      expect(last?.query?.offeringId).toBe(OTHER_OFFERING_ID);
    });
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

/** Drive a Radix Select from the keyboard (the CourseFormDialog arrangement). */
async function chooseOption(
  user: UserEvent,
  trigger: HTMLElement,
  label: string | RegExp,
): Promise<void> {
  trigger.focus();
  await user.keyboard('{Enter}');
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

// ---------------------------------------------------------------------------
// Enrolment gate — Phase 6 prerequisites, now per intake
// ---------------------------------------------------------------------------

const RUNG = { id: RUNG_ID, code: 'SMAW-100', name: 'SMAW Level 1' };

/** A published course with a rung, seen by a student who holds no row on it. */
function gatedCourse(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return course({
    offerings: [offering()],
    prerequisiteCourseId: RUNG_ID,
    prerequisite: RUNG,
    ...overrides,
  });
}

describe('CourseDetail enrolment gate — prerequisites', () => {
  it('disables the intake’s enrolment naming the rung while the student owes it', async () => {
    renderAttendance(gatedCourse(), VIEWER, { '/enrollments': () => EMPTY_PAGE });

    const button = await screen.findByRole('button', { name: /requires smaw-100/i });
    expect(button).toBeDisabled();
    // The named fact beside the button, spelled out in full.
    expect(screen.getByText('SMAW-100 · SMAW Level 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request seat/i })).toBeNull();
  });

  it('repeats the refusal on EVERY intake — the rung is a course fact', async () => {
    renderAttendance(
      gatedCourse({
        offerings: [offering(), offering({ id: OTHER_OFFERING_ID })],
      }),
      VIEWER,
      { '/enrollments': () => EMPTY_PAGE },
    );
    const buttons = await screen.findAllByRole('button', { name: /requires smaw-100/i });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const button of buttons) expect(button).toBeDisabled();
  });

  it('re-enables enrolment once the completed lookup holds the rung', async () => {
    // The #31 half: an APPROVED seat on SMAW-100 must turn the button ON, not
    // merely keep it from lying — a subject without `completedCourseIds` denies
    // every gated course silently.
    renderAttendance(gatedCourse(), VIEWER, {
      '/enrollments': () => ({
        data: [{ id: ENROLLMENT_ID, status: 'APPROVED', course: { id: RUNG_ID } }],
        meta: EMPTY_PAGE.meta,
      }),
    });

    expect(await screen.findByRole('button', { name: 'Request seat' })).toBeEnabled();
  });

  it('behaves as before when the course names no rung at all', async () => {
    renderAttendance(course({ offerings: [offering()] }), VIEWER);

    expect(await screen.findByRole('button', { name: 'Request seat' })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Seat refusals — Phase 7 workshop bounds, per intake
// ---------------------------------------------------------------------------

describe('CourseDetail intakes — workshop places', () => {
  it('shows the workshop remainder beside ordinary ones when bound', async () => {
    renderPage(
      course({
        offerings: [
          offering({
            viewerEnrollmentStatus: null,
            workshopCapacity: 5,
            workshopSeatsRemaining: 2,
          }),
        ],
      }),
    );

    expect(await screen.findByText('2 of 5 workshop places left')).toBeInTheDocument();
  });

  it('says nothing about a workshop where none is bound', async () => {
    renderPage(course({ offerings: [offering({ viewerEnrollmentStatus: null })] }));

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
    expect(screen.queryByText(/workshop places/i)).toBeNull();
  });

  it('keeps the ordinary full-intake copy for an intake with no workshop bound', async () => {
    renderPage(
      course({
        offerings: [offering({ viewerEnrollmentStatus: null, isFull: true, seatsRemaining: 0 })],
      }),
    );

    const button = await screen.findByRole('button', { name: /this intake is full/i });
    expect(button).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Decisions — the 409 that names its bound, per the REQUEST'S intake
// ---------------------------------------------------------------------------

describe('CourseDetail decisions — capacity refusals', () => {
  it('tells the approving teacher which bound fired when THE INTAKE’S workshop is full', async () => {
    // The 409's code maps to "This course is full." (problem.ts ERROR_COPY) and
    // its detail is diagnostics (#25) — so the screen answers from the cached
    // enrolment row, which carries the intake whose workshop is exhausted.
    apiPost.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CAPACITY_EXCEEDED',
        requestId: 'test',
      }),
    );
    renderAttendance(
      // The COURSE's own intakes stay ordinary; what matters is the PENDING row's
      // intake below — the bound that fired is the REQUEST's, not the template's.
      course(),
      TEACHER_USER,
      {
        [`/courses/${COURSE_ID}/enrollments`]: () => PENDING_PAGE,
        [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
          const query = (options as { query?: { date?: string; offeringId?: string } }).query ?? {};
          return attendanceRegister(query.date ?? '1970-01-01');
        },
      },
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /students/i }));
    // `DataTable` renders only the card branch here (jsdom's stubbed matchMedia
    // never matches `md`, per vitest.setup.ts), so there is one Approve button —
    // `findAllByRole` rather than `findByRole` only because a sibling row could
    // add a second one in a future fixture change.
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[0] as HTMLElement);

    expect(await screen.findByText('The workshop for this intake is full')).toBeInTheDocument();
  });
});
