/**
 * Pins the student-facing half of Phase 5: one enrolment's own attendance as a
 * compact summary, fetched only through `attendance:read` asked with the
 * ENROLLMENT-shaped subject (`isEnrolledStudent` reads `studentId` — the course
 * shape would deny every student, LESSONS-LEARNED #31's exact trap).
 *
 * Harness as in AttendanceRegister.test.tsx, plus the session seeded into the
 * cache exactly as CourseDetail.test.tsx does, because THIS component is the one
 * that asks who is watching.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { SessionUser } from '@/lib/session';
import type { AttendanceSummaryDto, EnrollmentDto } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

// Imported after the mocks so the component resolves the stubbed client.
import { EnrollmentAttendance } from './EnrollmentAttendance.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD2';
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';

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

function enrollment(overrides: Partial<EnrollmentDto> = {}): EnrollmentDto {
  return {
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
      department: { id: '01JGXDFAM0K2Z1GYCSNM5F5RD4', name: 'Welding', slug: 'welding' },
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
    ...overrides,
  };
}

const SUMMARY: AttendanceSummaryDto = {
  counts: { present: 4, absent: 1, late: 2 },
  total: 7,
  recent: [
    {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD5',
      enrollmentId: ENROLLMENT_ID,
      sessionDate: '2026-08-21T09:00:00.000Z',
      status: 'LATE',
      note: 'Bus broke down',
      markedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    },
    {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD6',
      enrollmentId: ENROLLMENT_ID,
      sessionDate: '2026-08-20T09:00:00.000Z',
      status: 'PRESENT',
      note: null,
      markedBy: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    },
  ],
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation((path) => {
    if (path === `/enrollments/${ENROLLMENT_ID}/attendance`) {
      return Promise.resolve(SUMMARY);
    }
    return Promise.resolve({});
  });
});

function renderCard(
  enrollmentRow: EnrollmentDto = enrollment(),
  user: SessionUser | null = VIEWER,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seeded even when null, so the session probe never reaches the api stub.
  client.setQueryData(qk.session, { user });
  return render(
    <QueryClientProvider client={client}>
      <EnrollmentAttendance enrollment={enrollmentRow} />
    </QueryClientProvider>,
  );
}

describe('EnrollmentAttendance', () => {
  it('renders the counts and the recent rows for its enrolment', async () => {
    renderCard();

    await screen.findByText('Recent sessions');

    // The three tiles: a status word and its number, side by side.
    expect(screen.getByText('Absent')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    const recent = screen.getByRole('list', { name: 'Recent sessions' });
    // The record's date renders as a formatted day; its note travels with it.
    expect(within(recent).getByText(/Bus broke down/)).toBeInTheDocument();
    within(recent).getByText('Late');
    within(recent).getByText('Present');
  });

  it('fetches the summary from the enrolment endpoint once', async () => {
    renderCard();

    await screen.findByText('Recent sessions');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith(`/enrollments/${ENROLLMENT_ID}/attendance`);
  });

  it('renders nothing while there is no viewer to own the subject', () => {
    /*
     * The subject is built FROM the signed-in user, so `isEnrolledStudent` can only
     * deny before a session resolves (or if one never does) — which is exactly the
     * state pinned here: no user in the cache, no fetch, no card. The deny that
     * actually decides what students see lives one level up, where a student
     * without an APPROVED enrolment never gets a row passed in at all.
     */
    const { container } = renderCard(enrollment(), null);

    expect(container).toBeEmptyDOMElement();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('offers a retry when the summary fails to load', async () => {
    apiGet.mockRejectedValue(new Error('transport died'));
    renderCard();

    expect(await screen.findByText(/attendance could not be loaded/i)).toBeInTheDocument();
  });
});
