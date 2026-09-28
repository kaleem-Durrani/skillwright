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
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

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
    /*
     * The real hook does NOT throw without a `RouterProvider` — it console.warns and
     * returns `undefined` (useRouter.tsx:15-22) — so a page that only navigates
     * after a click would pass every render-only test and then throw a TypeError
     * inside a mutation callback. Stubbing it here is what makes "the button
     * navigates to the thread it just created" an assertion rather than an accident.
     */
    useNavigate: () => navigate,
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

function renderPage(
  served: CourseDetail = course(),
  options: {
    viewer?: SessionUser;
    mine?: unknown;
    offeringTasks?: unknown[];
    certificates?: unknown;
    qualifications?: unknown;
    roster?: unknown;
  } = {},
): void {
  apiGet.mockImplementation((path) => {
    if (path === `/courses/${COURSE_ID}`) return Promise.resolve(served);
    // The student's own assignments, already joined server-side to whether they have
    // handed in and what they were marked. The panel asks for it by this exact path.
    if (path === '/assignments/mine') return Promise.resolve(options.mine ?? { data: [] });
    // The teacher's per-INTAKE list, which the route answers as a bare array (there is
    // no envelope and no pager: a task list is as long as the intake is).
    if (path.startsWith('/offerings/') && path.endsWith('/assignments')) {
      return Promise.resolve(options.offeringTasks ?? []);
    }
    // Phase 3. The certificate list self-scopes, so the Qualifications tab asks for it
    // with no filter at all; the catalogue is a bare array for the same reason the
    // per-intake task list is.
    if (path === '/certificates') {
      return Promise.resolve(options.certificates ?? { data: [] });
    }
    if (path === '/qualifications') return Promise.resolve(options.qualifications ?? []);
    // The students tab's roster, which the Phase 3 row action hangs off.
    if (path === `/courses/${COURSE_ID}/enrollments`) {
      return Promise.resolve(options.roster ?? EMPTY_PAGE);
    }
    // The resources tab's list; everything else this page might ask for is noise.
    return Promise.resolve(EMPTY_PAGE);
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: options.viewer ?? VIEWER });
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
  // Phase 1 added these two to the DTO, and every fixture below inherits them
  // through the spread — so they are spelled out ONCE here rather than in each row
  // that is not the completed one. A fixture that simply omits them is not a shape
  // the wire can produce: `enrollmentSchema` requires both keys (enrollment.ts:37-38)
  // and the route's response schema validates every row before it is served.
  completedAt: null,
  completedBy: null,
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

// ---------------------------------------------------------------------------
// Completion — Phase 1: the terminal state, and the correction path
// ---------------------------------------------------------------------------

const COMPLETED_AT = '2026-09-20T09:00:00.000Z';

/**
 * A COMPLETED row, carrying the two fields the Phase 1 backend added to the DTO.
 *
 * `completedBy` is the ACTOR who recorded the qualification, not the student — the
 * migration's `onDelete: SetNull` on the FK exists so the record of who signed it
 * outlives their account, and a fixture that put the student's own name there would
 * make the two indistinguishable in the very assertion this exists to support.
 */
const COMPLETED_PAGE = {
  data: [
    {
      ...OWN_ENROLLMENT,
      status: 'COMPLETED',
      completedAt: COMPLETED_AT,
      completedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    },
  ],
  meta: EMPTY_PAGE.meta,
};

/** Open the Students tab, which is where every roster action lives. */
async function openStudentsTab(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
  await userEvent.click(await screen.findByRole('tab', { name: /students/i }));
}

describe('CourseDetail completion — the owning teacher', () => {
  it('records a completion on an APPROVED row through the same decide mutation', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
        const query = (options as { query?: { date?: string } }).query ?? {};
        return attendanceRegister(query.date ?? '1970-01-01');
      },
    });

    await openStudentsTab();
    // `ROSTER_PAGE` holds two approved seats, and `findAllByRole` rather than
    // `findByRole` for the same reason the capacity test above uses it.
    const completeButtons = await screen.findAllByRole('button', { name: 'Complete' });
    await user.click(completeButtons[0] as HTMLElement);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    // The verb is the completion one, and the BODY is the empty object the route's
    // `.nullish()` schema wants: Fastify hands a bodyless POST to the validator as
    // `null` (LESSONS-LEARNED #12), so `{}` is not pedantry.
    expect(path).toBe(`/enrollments/${ENROLLMENT_ID}/complete`);
    expect(body).toEqual({});
  });

  it('reads a COMPLETED row as terminal — date, recorder, and no other verb', async () => {
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => COMPLETED_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
        const query = (options as { query?: { date?: string } }).query ?? {};
        return attendanceRegister(query.date ?? '1970-01-01');
      },
    });

    await openStudentsTab();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    // The stamp names WHEN and WHO, not merely the state.
    expect(screen.getByText(/recorded by Dana Okafor/)).toBeInTheDocument();

    // The only verb a COMPLETED row answers to. `assertTransition` refuses approve,
    // reject and withdraw from here with a 409, so a button for any of them is a
    // guarantee of failure.
    expect(await screen.findByRole('button', { name: 'Uncomplete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('takes a completion back through its own verb, not a second complete', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => COMPLETED_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: (_path, options) => {
        const query = (options as { query?: { date?: string } }).query ?? {};
        return attendanceRegister(query.date ?? '1970-01-01');
      },
    });

    await openStudentsTab();
    await user.click(await screen.findByRole('button', { name: 'Uncomplete' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path] = apiPost.mock.calls[0] as [string];
    expect(path).toBe(`/enrollments/${ENROLLMENT_ID}/uncomplete`);
  });

  it('offers a non-owning teacher neither verb, because ownsCourse reads the course', async () => {
    renderAttendance(
      course({
        teacher: { id: OTHER_STUDENT_ID, name: 'Someone Else', role: 'TEACHER', avatarUrl: null },
        offerings: [offering({ viewerEnrollmentStatus: null })],
      }),
      TEACHER_USER,
      {
        [`/courses/${COURSE_ID}/enrollments`]: () => COMPLETED_PAGE,
      },
    );

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    // The whole Students tab is absent, so neither verb can be reached at all. Note
    // what this does NOT prove: `ownsCourse` refusing a colleague is decided by the
    // `Gate` on the ROW's subject, and the tab's absence means the gate was never
    // asked. `EnrollmentCompletionActions.test.tsx` drives that gate directly, with a
    // roster this page would not have served.
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /students/i })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /^complete$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^uncomplete$/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Withdrawal — Phase 5, gap 1: the viewer's own seat
// ---------------------------------------------------------------------------

/** The viewer's own PENDING request, on a course whose intake agrees that they hold one. */
const OWN_PENDING = {
  ...OWN_ENROLLMENT,
  id: '01JGXDFAM0K2Z1GYCSNM5F5RD7',
  status: 'PENDING',
  decidedAt: null,
  decidedBy: null,
};

function pendingSeatCourse(): CourseDetail {
  return course({ offerings: [offering({ viewerEnrollmentStatus: 'PENDING' })] });
}

describe('CourseDetail withdrawal — the viewer’s own seat', () => {
  it('offers a student the withdrawal on a request they may no longer want', async () => {
    renderAttendance(pendingSeatCourse(), VIEWER, {
      '/enrollments': () => ({ data: [OWN_PENDING], meta: EMPTY_PAGE.meta }),
    });

    expect(await screen.findByRole('heading', { name: 'Your place' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  it('sends the reason it collected', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderAttendance(pendingSeatCourse(), VIEWER, {
      '/enrollments': () => ({ data: [OWN_PENDING], meta: EMPTY_PAGE.meta }),
    });

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'My Thursday shifts changed.');
    // Scoped to the dialog, because the card's own Withdraw is still on screen
    // behind it and opened this.
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/enrollments/${OWN_PENDING.id}/withdraw`);
    expect(body).toEqual({ reason: 'My Thursday shifts changed.' });
  });

  it('calls the reason OPTIONAL in the copy, because the wire schema is', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderAttendance(pendingSeatCourse(), VIEWER, {
      '/enrollments': () => ({ data: [OWN_PENDING], meta: EMPTY_PAGE.meta }),
    });

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');

    // A confirm that demanded a reason would be the Messages screen's empty-state
    // lie pointed at an endpoint that does not: `withdrawEnrollmentSchema` is
    // `reason: …optional()` and the route binds it `.nullish()`.
    expect(within(dialog).getByText(/optional, up to 500 characters/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    // An empty reason sends the EMPTY OBJECT, not `{ reason: '' }` — an empty
    // string would land in `decisionNote` as an empty string, which is not the null
    // `settle` writes for a reasonless withdrawal.
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({});
  });

  it('offers a TEACHER no withdrawal at all, even on their own course', async () => {
    // A teacher owns every seat on their course and may approve or reject one, but
    // `enrollment:withdraw` is a bare `deny` for the role (policy.ts:227-233): a
    // teacher removing a student is a REJECTION — a different verb, a different audit
    // row, a different notification.
    //
    // This test proves the SECTION is absent, not that the `Gate` refused. Two
    // independent facts make it so here: the payload carries no
    // `viewerEnrollmentStatus` for a non-student (courses.service.ts:329), so the
    // lookup never runs, and no row in the list is theirs. `ViewerSeatActions.test.tsx`
    // removes both and drives the gate directly.
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
    });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    expect(screen.queryByRole('heading', { name: 'Your place' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('never shows the section to a student who holds no row on this course', async () => {
    renderAttendance(course({ offerings: [offering({ viewerEnrollmentStatus: null })] }), VIEWER, {
      '/enrollments': () => EMPTY_PAGE,
    });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    expect(screen.queryByRole('heading', { name: 'Your place' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Start a conversation — Phase 5, gap 2
// ---------------------------------------------------------------------------

const CONVERSATION_ID = '01JGXDFAM0K2Z1GYCSNM5F5RE1';

describe('CourseDetail conversation', () => {
  it('opens the thread with this course’s teacher, find-or-create in one POST', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({ id: CONVERSATION_ID });
    renderAttendance(course({ offerings: [offering({ viewerEnrollmentStatus: null })] }), VIEWER, {
      '/enrollments': () => EMPTY_PAGE,
    });

    await user.click(await screen.findByRole('button', { name: /message dana/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/conversations');
    /*
     * NO `title` and NO `message`, and both omissions are load-bearing. The server
     * dedups a direct thread only when `title === undefined`
     * (conversations.service.ts:449-455), so a title would create a NEW conversation
     * on every click; and an opening message is posted under a freshly minted
     * idempotency key, so a retried create would put a second line in the thread it
     * had just found.
     */
    expect(body).toEqual({ participantIds: [TEACHER_ID] });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/messages',
        search: { conversationId: CONVERSATION_ID },
      }),
    );
  });

  it('gives a teacher no button on their own course, because they would message themself', async () => {
    renderAttendance(course(), TEACHER_USER, { '/enrollments': () => EMPTY_PAGE });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });

    // Not a policy denial — `conversation:create` is a bare allow for all three
    // signed-in roles — but a one-participant thread is not a conversation, and the
    // server's dedup branch needs two.
    expect(screen.queryByRole('button', { name: /message/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assignments tab
// ---------------------------------------------------------------------------

/**
 * The training itself, on the course page.
 *
 * The tab is UNGATED, and that is the assertion this block exists to make durable.
 * `assignment:read` is a subject-dependent rule — a student needs an APPROVED seat and
 * a teacher needs `ownsCourse` — so a subject-free `can()` on the trigger would deny
 * every viewer including admins, and a gate on the COURSE subject would deny every
 * seated student, because the answer is per-INTAKE. Both are LESSONS-LEARNED #15 and
 * #31, and the list underneath self-scopes on the server instead.
 */

/** One row of `GET /assignments/mine`: the task, joined to the viewer's own hand-in. */
function myAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RE1',
    offeringId: OFFERING_ID,
    title: 'Weld the fillet',
    brief: 'Two runs of a 6mm fillet, all round.',
    dueAt: '2030-03-14T09:00:00.000Z',
    maxScore: 100,
    resourceId: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    course: { id: COURSE_ID, name: 'Welding Fundamentals', code: 'WELD-101' },
    submission: null,
    submissionCount: 0,
    scorePercent: null,
    overdue: false,
    ...overrides,
  };
}

/** A committed hand-in, as `submissionSchema` serves it. */
function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RE2',
    assignmentId: '01JGXDFAM0K2Z1GYCSNM5F5RE1',
    enrollmentId: '01JGXDFAM0K2Z1GYCSNM5F5RE3',
    status: 'SUBMITTED',
    attempt: 1,
    score: null,
    feedback: null,
    submittedAt: '2026-09-02T09:00:00.000Z',
    gradedAt: null,
    gradedBy: null,
    upload: {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RE4',
      originalName: 'fillet-weld.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    },
    createdAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('CourseDetail assignments — a student', () => {
  it('offers the tab and renders the task with its deadline and its brief', async () => {
    renderPage(course(), { mine: { data: [myAssignment()] } });

    const tab = await screen.findByRole('tab', { name: 'Assignments' });
    await userEvent.click(tab);

    expect(await screen.findByText('Weld the fillet')).toBeInTheDocument();
    // The brief is rendered in FULL, not clamped: a student who has to guess what a
    // task wants is a student who guesses wrong.
    expect(screen.getByText(/Two runs of a 6mm fillet/)).toBeInTheDocument();
    expect(screen.getByText(/out of 100/)).toBeInTheDocument();
  });

  it('shows the mark and the feedback once the work has been graded', async () => {
    renderPage(course(), {
      mine: {
        data: [
          myAssignment({
            submission: submission({
              status: 'GRADED',
              score: 62.5,
              feedback: 'Good root, a little proud on the third leg.',
              gradedAt: '2026-09-04T09:00:00.000Z',
              gradedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
            }),
            submissionCount: 1,
            scorePercent: 62.5,
          }),
        ],
      },
    });

    await userEvent.click(await screen.findByRole('tab', { name: 'Assignments' }));

    expect(await screen.findByText(/62.5 \/ 100 \(62.5%\)/)).toBeInTheDocument();
    expect(screen.getByText('Good root, a little proud on the third leg.')).toBeInTheDocument();
    // Scoped to the feedback block: the header's "Message" button carries the same
    // name, and an unscoped query here would pass on the wrong element.
    expect(screen.getByText(/Dana Okafor’s feedback/)).toBeInTheDocument();
  });

  /*
   * The null contract, and it is worth a test rather than a comment.
   *
   * An ungraded or returned hand-in has had NO mark, and the server sends
   * `scorePercent: null` precisely so a client cannot invent one. Rendering that null
   * as "0%" would tell a student they failed a task nobody has read yet, which is the
   * single worst thing this screen could do.
   */
  it('never renders a mark for a hand-in nobody has graded', async () => {
    renderPage(course(), {
      mine: {
        data: [
          myAssignment({
            submission: submission({ status: 'RETURNED', feedback: 'Undercut — run it again.' }),
            submissionCount: 1,
          }),
        ],
      },
    });

    await userEvent.click(await screen.findByRole('tab', { name: 'Assignments' }));

    expect(await screen.findByText('Undercut — run it again.')).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/ 100/)).not.toBeInTheDocument();
    // And the way back is named for what it does, not for what it is called elsewhere.
    expect(screen.getByRole('button', { name: 'Hand in again' })).toBeInTheDocument();
  });

  it('says so when nothing has been set, without claiming the teacher has not', async () => {
    renderPage(course(), { mine: { data: [] } });

    await userEvent.click(await screen.findByRole('tab', { name: 'Assignments' }));

    expect(await screen.findByText('No tasks set yet')).toBeInTheDocument();
  });
});

describe('CourseDetail assignments — a teacher', () => {
  const TEACHER: SessionUser = {
    id: TEACHER_ID,
    email: 'teacher@example.edu',
    name: 'Dana Okafor',
    role: 'TEACHER',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
  };

  it('offers to set a task on a course they own', async () => {
    renderPage(course(), { viewer: TEACHER });

    await userEvent.click(await screen.findByRole('tab', { name: 'Assignments' }));

    /*
     * TWO, and deliberately: the panel's own header action and the empty state's, which
     * is the same arrangement the Resources tab already has ("Add a resource" in both
     * places). They open ONE dialog, so there is one create flow rather than two that
     * can drift — and a test that asserted `getByRole` here would be asserting that
     * the second one had been deleted, which is the opposite of the intent.
     */
    await screen.findByText('No tasks on this intake yet');
    expect(screen.getAllByRole('button', { name: 'Set a task' })).toHaveLength(2);
  });

  /*
   * `assignment:create` is `ownsCourse`, which reads `courseTeacherId` — a field that
   * lives on the COURSE. A teacher looking at a colleague's course must therefore see
   * no button at all rather than one the API would answer 403 for, and this is the
   * same guarantee the resources tab's row menu makes.
   */
  it('offers nothing on a course they do not own', async () => {
    const colleague = {
      ...course(),
      teacher: {
        id: '01JGXDFAM0K2Z1GYCSNM5F5RDX',
        name: 'Sam Ilori',
        role: 'TEACHER',
        avatarUrl: null,
      },
    } satisfies CourseDetail;

    renderPage(colleague, { viewer: TEACHER });

    await userEvent.click(await screen.findByRole('tab', { name: 'Assignments' }));

    await screen.findByText('No tasks on this intake yet');
    expect(screen.queryByRole('button', { name: 'Set a task' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Certificates — Phase 3: the Qualifications tab, and issuing from a finished seat
// ---------------------------------------------------------------------------

/**
 * The Phase 1 block above already declares a `COMPLETED_PAGE` fixture, and this one
 * REUSES it rather than declaring a second that says the same thing with a different
 * date. Two fixtures for one state is how a test ends up asserting against a shape the
 * wire cannot produce, and the reader of the second learns nothing the first did not
 * say.
 */

const CERTIFICATE = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RE1',
  reference: '9F2A7C4B1D6E8A035C7B9D2E4K6P',
  issuedAt: '2026-09-20T09:00:00.000Z',
  issuedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
  qualification: {
    id: 'q-1',
    code: 'cswip-31',
    name: 'CSWIP 3.1 Welding Inspector',
    level: '3',
    awardingBody: 'BSI',
  },
  enrollmentId: ENROLLMENT_ID,
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
  artifact: {
    id: 'up-1',
    originalName: 'certificate-9F2A7C4B1D6E8A035C7B9D2E4K6P.pdf',
    contentType: 'application/pdf',
    sizeBytes: 3854,
  },
};

const CATALOGUE = [
  {
    id: 'q-1',
    code: 'cswip-31',
    name: 'CSWIP 3.1 Welding Inspector',
    level: '3',
    awardingBody: 'BSI',
  },
];

describe('CourseDetail — the Qualifications tab', () => {
  it('is offered to a student, and fetches its own list when opened', async () => {
    renderPage(course(), { certificates: { data: [CERTIFICATE] } });

    const tab = await screen.findByRole('tab', { name: 'Qualifications' });
    await userEvent.click(tab);

    // The fetch is the assertion. This tab has NO policy gate — `certificate:read`
    // reads `studentId` and `courseTeacherId` and this screen has neither, so a bare
    // `can()` would deny every viewer and the panel would sit on its skeleton forever
    // with no error and no log line (LESSONS-LEARNED #15). The list self-scopes on the
    // server instead, and a regression that re-adds a gate would show up as this never
    // resolving rather than as anything on screen.
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/certificates'));
    expect(await screen.findByText('CSWIP 3.1 Welding Inspector')).toBeInTheDocument();
  });

  it('is not offered to a teacher, because a certificate is a student’s record', async () => {
    renderPage(course(), { viewer: TEACHER_USER });

    await screen.findByRole('heading', { level: 1, name: 'Welding Fundamentals' });
    expect(screen.queryByRole('tab', { name: 'Qualifications' })).not.toBeInTheDocument();
  });

  it('says so plainly when there is nothing to show', async () => {
    renderPage(course());
    await userEvent.click(await screen.findByRole('tab', { name: 'Qualifications' }));

    expect(await screen.findByText('No qualifications yet')).toBeInTheDocument();
  });
});

describe('CourseDetail — issuing a certificate', () => {
  beforeAll(() => {
    for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
      Object.defineProperty(Element.prototype, name, {
        value: () => false,
        writable: true,
        configurable: true,
      });
    }
  });

  it('offers the control on no APPROVED seat, because the API refuses one with a 409', async () => {
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => ROSTER_PAGE,
      // The register is the tab's working surface and is stubbed here only so it does
      // not crash on a response shape this file does not model — it is not what these
      // tests are about, and the existing completion tests stub it for the same reason.
      [`/courses/${COURSE_ID}/attendance`]: () => attendanceRegister('1970-01-01'),
    });

    await openStudentsTab();

    // An APPROVED seat has not been completed, and a certificate is only ever conferred
    // from a COMPLETED one. The affordance is not rendered at all rather than rendered
    // and refused — the same reason `EnrollmentCompletionActions` offers Complete only
    // where `ALLOWED_TRANSITIONS` permits it.
    expect(screen.queryByRole('button', { name: 'Issue certificate' })).not.toBeInTheDocument();
  });

  it('opens a dialog naming the student, and posts the SEAT', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue(CERTIFICATE);
    renderAttendance(course(), TEACHER_USER, {
      [`/courses/${COURSE_ID}/enrollments`]: () => COMPLETED_PAGE,
      [`/courses/${COURSE_ID}/attendance`]: () => attendanceRegister('1970-01-01'),
      '/qualifications': () => CATALOGUE,
    });

    await openStudentsTab();
    await user.click(await screen.findByRole('button', { name: 'Issue certificate' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Ada Okafor completed Welding Fundamentals/),
    ).toBeInTheDocument();

    const trigger = within(dialog).getByRole('combobox', { name: 'Qualification' });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: /CSWIP 3.1/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Issue certificate' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    // The seat, not the student. A body carrying `studentId` would let a certificate be
    // issued to somebody who never sat the course, and the service would have nothing
    // to check that against.
    expect(apiPost.mock.calls[0]?.[1]).toEqual({
      enrollmentId: ENROLLMENT_ID,
      qualificationId: 'q-1',
    });
  });
});
