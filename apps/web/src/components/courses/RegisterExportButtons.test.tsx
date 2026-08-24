/**
 * Pins Phase 8's course-screen download affordance: the two register exports appear
 * for exactly the viewers the SERVER's gates would answer — `enrollment:read` and
 * `attendance:read` asked with the COURSE subject (`ownsCourse` reads
 * `courseTeacherId`; a student's cell denies) — and each anchor points at the same
 * origin the session cookie rides on.
 *
 * Harness as in CoursePublishButton.test.tsx: network stubbed at `@/lib/api`, the
 * viewer planted in the query cache under `qk.session`.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiFetch>() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

// Imported after the mock so the component resolves the stubbed client.
import { RegisterExportButtons } from './RegisterExportButtons.js';

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD9';
const OTHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: TEACHER_ID,
    email: 'teacher@example.edu',
    name: 'Dana Okafor',
    role: 'TEACHER',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

function renderButtons(session: SessionUser): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: session });
  return render(
    <QueryClientProvider client={client}>
      <RegisterExportButtons courseId={COURSE_ID} teacherId={TEACHER_ID} offeringId={OFFERING_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegisterExportButtons', () => {
  it('offers both registers to the teacher who owns the course, scoped to ONE intake', () => {
    renderButtons(viewer());

    const enrollments = screen.getByRole('link', { name: 'Export the enrolment register as CSV' });
    expect(enrollments).toHaveAttribute(
      'href',
      `/api/v1/enrollments/export?courseId=${COURSE_ID}&offeringId=${OFFERING_ID}`,
    );
    expect(enrollments).toHaveAttribute('download');

    const attendance = screen.getByRole('link', { name: 'Export the attendance register as CSV' });
    // The attendance export REQUIRES the intake (attendanceExportQuerySchema) — an
    // anchor without it would be answered 422, so the query rides the same selection
    // the on-screen register does.
    expect(attendance).toHaveAttribute(
      'href',
      `/api/v1/courses/${COURSE_ID}/attendance/export?offeringId=${OFFERING_ID}`,
    );
    expect(attendance).toHaveAttribute('download');
  });

  it('offers both to an admin, whose policy cells allow outright', () => {
    renderButtons(viewer({ id: OTHER_ID, role: 'ADMIN', email: 'dean@example.edu' }));

    expect(
      screen.getByRole('link', { name: 'Export the enrolment register as CSV' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Export the attendance register as CSV' }),
    ).toBeInTheDocument();
  });

  it('renders nothing for a student, whom both course-shaped subjects deny', () => {
    const { container } = renderButtons(viewer({ id: OTHER_ID, role: 'STUDENT' }));
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders nothing for a teacher who does not own the course', () => {
    // `ownsCourse` compares the subject's courseTeacherId to the actor; the mismatch
    // denies exactly as an absence of the field would.
    const { container } = renderButtons(viewer({ id: OTHER_ID }));
    expect(container.querySelector('a')).toBeNull();
  });
});
