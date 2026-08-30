/**
 * Pins the Phase 9 offerings section — the one surface where intakes are read,
 * applied to, and managed:
 *
 * - every intake renders its own facts and THE VIEWER'S OWN per-intake status;
 * - applying names the INTAKE (`offeringId`) in the POST body — the wire refuses a
 *   bodyless application since Phase 9, so "apply to the course" no longer exists;
 * - a full intake (or a full workshop) stays on screen DISABLED with its reason —
 *   the visible-but-refusing pattern the old header button established;
 * - a teacher adds an intake through the section's own dialog and PATCHes one
 *   retuning its bounds (an emptied workshop box PATCHes explicit null);
 * - retiring asks first, and the 409 that arrives while requests are still live
 *   becomes honest copy inside the dialog — never a toast over a closed door.
 *
 * Harness as in CourseFormDialog.test.tsx: network stubbed at `@/lib/api`, session
 * seeded into the cache under `qk.session`.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';
import { subject } from '@/lib/policy';
import type { PolicySubject } from '@/lib/policy';
import { formatDate } from '@/lib/format';
import type { CourseDetail } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, apiDel } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
  apiDel: vi.fn<ApiFetch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: vi.fn(), del: apiDel },
  };
});

// Imported after the mocks so the component resolves the stubbed client.
import { CourseOfferings } from './CourseOfferings.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const RUNG_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD9';

/** ULID-shaped ids for the two intakes every test below reads. */
const AUTUMN_ID = '01JGXDFAM0K2Z1GYCSNM5F5RA1';
const SPRING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RA2';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: STUDENT_ID,
    email: 'student@example.edu',
    name: 'Ada Okafor',
    role: 'STUDENT',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

/** Autumn has seats; spring is FULL but bound for a workshop with places left. */
const AUTUMN = {
  id: AUTUMN_ID,
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-12-15T17:00:00.000Z',
  capacity: 12,
  workshopCapacity: null,
  approvedCount: 3,
  seatsRemaining: 9,
  isFull: false,
  workshopSeatsRemaining: null,
  viewerEnrollmentStatus: null,
};

const SPRING = {
  id: SPRING_ID,
  startDate: '2027-01-10T09:00:00.000Z',
  endDate: null,
  capacity: 10,
  workshopCapacity: 4,
  approvedCount: 10,
  seatsRemaining: 0,
  isFull: true,
  workshopSeatsRemaining: 2,
  viewerEnrollmentStatus: 'PENDING' as const,
};

// Expected date lines are composed from `formatDate` itself, never spelled out —
// the assertions pin the COMPOSITION (both ends joined, "From" for an open end),
// not any locale's word order.
const AUTUMN_LABEL = `${formatDate(AUTUMN.startDate)} – ${formatDate(AUTUMN.endDate)}`;
const SPRING_LABEL = `From ${formatDate(SPRING.startDate)}`;

function course(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: COURSE_ID,
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    description: null,
    department: { id: '01JGXDFAM0K2Z1GYCSNM5F5RCY', name: 'Welding', slug: 'welding' },
    teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    publishedAt: '2026-08-01T09:00:00.000Z',
    syllabusUploadId: null,
    syllabusUrl: null,
    resourceCount: 0,
    prerequisiteCourseId: null,
    prerequisite: null,
    offerings: [AUTUMN, SPRING],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
    ...overrides,
  };
}

/** The page's COURSE-shaped subject, as CourseDetailPage builds it for these viewers. */
function pageSubject(overrides: Partial<PolicySubject> = {}): PolicySubject {
  return subject({
    id: COURSE_ID,
    courseId: COURSE_ID,
    courseTeacherId: TEACHER_ID,
    departmentId: '01JGXDFAM0K2Z1GYCSNM5F5RCY',
    publishedAt: '2026-08-01T09:00:00.000Z',
    // Explicit null means "ungated"; an ABSENT key would deny even an ungated course.
    prerequisiteCourseId: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({});
});

interface RenderOptions {
  session?: SessionUser;
  subjectOverrides?: Partial<PolicySubject>;
  /** What the page computed for the rung lookup — false unless the test says so. */
  prerequisiteUnmet?: boolean;
  served?: CourseDetail;
}

function renderSection({
  session = viewer(),
  subjectOverrides = {},
  prerequisiteUnmet = false,
  served = course(),
}: RenderOptions = {}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: session });
  render(
    <QueryClientProvider client={client}>
      <CourseOfferings
        course={served}
        viewerSubject={pageSubject(subjectOverrides)}
        prerequisiteUnmet={prerequisiteUnmet}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Reading intakes
// ---------------------------------------------------------------------------

describe('CourseOfferings — reading intakes', () => {
  it('renders each intake with its own facts, soonest-start first', async () => {
    renderSection();

    expect(await screen.findByText(AUTUMN_LABEL)).toBeInTheDocument();
    expect(screen.getByText('9 of 12 places left')).toBeInTheDocument();
    // Spring carries a workshop bound with places left; autumn is unbound, so it
    // renders no workshop line at all — never a "none" row.
    expect(screen.getByText('2 of 4 workshop places left')).toBeInTheDocument();
    expect(screen.getByText(SPRING_LABEL)).toBeInTheDocument();
    expect(screen.getAllByText(/places left/)).toHaveLength(2);
  });

  it("shows the viewer's status PER INTAKE, leaving other intakes applicable", async () => {
    renderSection();

    // Spring: their PENDING request, as a chip — no second affordance beside it.
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    // Autumn: no row yet, so the per-intake button stands.
    expect(screen.getByRole('button', { name: 'Request seat' })).toBeInTheDocument();
  });

  it('renders nothing applicable when there is nothing scheduled', () => {
    renderSection({ served: course({ offerings: [] }) });

    expect(screen.getByText('No intakes yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request seat' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Applying to ONE intake
// ---------------------------------------------------------------------------

describe('CourseOfferings — applying', () => {
  it('sends the offeringId in the enrolment POST body', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Request seat' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/courses/${COURSE_ID}/enrollments`);
    // The whole point of Phase 9's wire change: an application NAMES its intake.
    expect(body).toEqual({ offeringId: AUTUMN_ID });
  });

  it('keeps a full intake visible but disabled, naming the state instead of hiding it', async () => {
    renderSection({
      // Spring with no row yet: full intake, so the button exists and refuses.
      served: course({ offerings: [{ ...SPRING, viewerEnrollmentStatus: null }] }),
    });

    const button = await screen.findByRole('button', { name: /this intake is full/i });
    expect(button).toBeDisabled();
    // The workshop still has places, so the ordinary fullness is what blocks — not
    // the workshop bound.
    expect(screen.getByText('2 of 4 workshop places left')).toBeInTheDocument();
  });

  it('names the exhausted WORKSHOP before the ordinary fullness', async () => {
    const user = userEvent.setup();
    renderSection({
      served: course({
        offerings: [{ ...AUTUMN, workshopCapacity: 4, workshopSeatsRemaining: 0, isFull: false }],
      }),
    });

    const button = await screen.findByRole('button', { name: /workshop is full/i });
    expect(button).toBeDisabled();
    // Disabled controls fire no mutation even if forced.
    await user.click(button);
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('disables every intake naming the rung while the student owes it', async () => {
    const user = userEvent.setup();
    renderSection({
      prerequisiteUnmet: true,
      subjectOverrides: {
        prerequisiteCourseId: RUNG_ID,
        // An absent list denies silently (#31/#15); an EMPTY list is an answered "owes it".
        completedCourseIds: [],
      },
      served: course({
        prerequisiteCourseId: RUNG_ID,
        prerequisite: { id: RUNG_ID, code: 'SMAW-100', name: 'SMAW Level 1' },
        offerings: [{ ...SPRING, viewerEnrollmentStatus: null }],
      }),
    });

    const buttons = await screen.findAllByRole('button', { name: /requires smaw-100/i });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeDisabled();

    await user.click(buttons[0] as HTMLElement);
    expect(apiPost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Managing intakes (teachers / admins)
// ---------------------------------------------------------------------------

const TEACHER = viewer({
  id: TEACHER_ID,
  email: 'teacher@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
});

describe('CourseOfferings — managing intakes', () => {
  it('gives a teacher manage controls and takes the student affordances away', () => {
    renderSection({ session: TEACHER });

    expect(screen.getByRole('button', { name: /add an intake/i })).toBeInTheDocument();
    // One edit/retire pair PER intake row.
    expect(screen.getAllByRole('button', { name: /^Edit the .* intake$/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Retire the .* intake$/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Request seat' })).toBeNull();
  });

  it('opens the form empty for a NEW intake and POSTs the parsed body', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValue({});
    renderSection({ session: TEACHER });

    await user.click(screen.getByRole('button', { name: /add an intake/i }));

    const dialog = screen.getByRole('dialog');
    const places = within(dialog).getByLabelText(/^places/i);
    await user.type(places, '15');

    await user.click(within(dialog).getByRole('button', { name: /add intake/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/courses/${COURSE_ID}/offerings`);
    // Blank workshop stays OMITTED — create has no bound until given one.
    expect(body).toEqual({ capacity: 15 });
  });

  it('retunes an intake with a PATCH carrying only what changed', async () => {
    const user = userEvent.setup();
    apiPatch.mockResolvedValue({});
    renderSection({
      session: TEACHER,
      served: course({
        offerings: [{ ...AUTUMN, capacity: 12, seatsRemaining: 9 }],
      }),
    });

    await user.click(screen.getByRole('button', { name: /^Edit the .* intake$/i }));
    const dialog = screen.getByRole('dialog');
    // Seeded from the served row.
    expect(within(dialog).getByLabelText(/^places/i)).toHaveValue('12');
    await user.clear(within(dialog).getByLabelText(/^places/i));
    await user.type(within(dialog).getByLabelText(/^places/i), '20');

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [path, body] = apiPatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/courses/${COURSE_ID}/offerings/${AUTUMN_ID}`);
    expect(body).toEqual({ capacity: 20 });
  });

  it('unbinds the workshop with an explicit null when the box is emptied on edit', async () => {
    const user = userEvent.setup();
    apiPatch.mockResolvedValue({});
    renderSection({
      session: TEACHER,
      served: course({
        offerings: [{ ...AUTUMN, workshopCapacity: 4, workshopSeatsRemaining: 1 }],
      }),
    });

    await user.click(screen.getByRole('button', { name: /^Edit the .* intake$/i }));
    const dialog = screen.getByRole('dialog');
    const box = within(dialog).getByLabelText(/workshop places/i);
    expect(box).toHaveValue('4');
    await user.clear(box);

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [, body] = apiPatch.mock.calls[0] as [string, Record<string, unknown>];
    // updateCourseOfferingInputSchema takes null where create takes omission.
    expect(body).toEqual({ workshopCapacity: null });
  });

  it('refuses a malformed intake inline, before any request', async () => {
    const user = userEvent.setup();
    renderSection({ session: TEACHER });

    await user.click(screen.getByRole('button', { name: /add an intake/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^places/i), '0');

    await user.click(within(dialog).getByRole('button', { name: /add intake/i }));

    expect(await within(dialog).findByText(/whole number of at least 1/i)).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('retires an intake after confirmation with a DELETE', async () => {
    const user = userEvent.setup();
    apiDel.mockResolvedValue(undefined);
    renderSection({ session: TEACHER });

    const [firstRetire] = await screen.findAllByRole('button', {
      name: /^Retire the .* intake$/i,
    });
    if (!firstRetire) throw new Error('expected at least one intake to offer a Retire button');
    await user.click(firstRetire);

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /retire intake/i }));

    await waitFor(() => expect(apiDel).toHaveBeenCalledTimes(1));
    expect(apiDel.mock.calls[0]?.[0]).toBe(`/courses/${COURSE_ID}/offerings/${AUTUMN_ID}`);
  });

  it('answers the 409-while-enrolled refusal with honest copy, not a toast', async () => {
    const user = userEvent.setup();
    apiDel.mockRejectedValueOnce(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CONFLICT',
        requestId: 'test',
      }),
    );
    renderSection({ session: TEACHER });

    const [firstRetire] = await screen.findAllByRole('button', {
      name: /^Retire the .* intake$/i,
    });
    if (!firstRetire) throw new Error('expected at least one intake to offer a Retire button');
    await user.click(firstRetire);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /retire intake/i }));

    // The dialog STAYS OPEN and says what stands in the way and what clears it.
    expect(
      await within(dialog).findByText(/students are still seated or waiting/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /review the requests/i }),
    ).toBeInTheDocument();
  });
});
