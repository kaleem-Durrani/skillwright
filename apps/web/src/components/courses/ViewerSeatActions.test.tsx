/**
 * The viewer's own seat, and the one verb that belongs to it.
 *
 * The page-level pins in `CourseDetail.test.tsx` prove the button is reachable
 * and that it POSTs the right body. What they CANNOT prove is the denial, because
 * on a real payload a teacher never gets far enough to be denied:
 * `viewerEnrollmentStatusByOffering` returns an empty Map for anyone who is not a
 * STUDENT (courses.service.ts:329), so the section never renders and its absence
 * says nothing about the gate inside it. These tests drive the component directly
 * with the payload a server would not send, which is the only way to reach the
 * `Gate` and watch it refuse.
 *
 * Watched failing before they were trusted: replacing `<Gate action="enrollment:withdraw">`
 * with a bare fragment left the page suite at 30/30 green.
 */
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';

type ApiGet = (path: string, options?: unknown) => Promise<unknown>;
type ApiPost = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiGet>(),
  apiPost: vi.fn<ApiPost>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Link: ({ children }: { children?: ReactNode }) => <>{children}</> };
});

import { ViewerSeatActions } from './ViewerSeatActions';
import { Toaster } from '@/components/ui/Toast';

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD7';
const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD3';

const STUDENT: SessionUser = {
  id: STUDENT_ID,
  email: 'ada@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const TEACHER: SessionUser = { ...STUDENT, id: TEACHER_ID, role: 'TEACHER', name: 'Dana Okafor' };

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

function offering(status: 'PENDING' | 'APPROVED' | null) {
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
    viewerEnrollmentStatus: status,
  };
}

function course(status: 'PENDING' | 'APPROVED' | null): CourseDetail {
  return {
    id: COURSE_ID,
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    description: null,
    department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
    teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    publishedAt: '2026-08-01T09:00:00.000Z',
    syllabusUploadId: null,
    syllabusUrl: null,
    resourceCount: 0,
    prerequisiteCourseId: null,
    prerequisite: null,
    offerings: [offering(status)],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  };
}

/** The viewer's own row, on the seat the course payload says they hold. */
function row(overrides: Partial<EnrollmentDto> = {}) {
  return {
    id: ENROLLMENT_ID,
    status: 'PENDING',
    requestedAt: '2026-08-01T09:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
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
    offering: offering('PENDING'),
    ...overrides,
  } as EnrollmentDto;
}

function renderSeat(served: CourseDetail, viewer: SessionUser, rows: unknown[]): void {
  apiGet.mockImplementation((path) => {
    if (path === `/courses/${COURSE_ID}`) return Promise.resolve(served);
    if (path === '/enrollments') return Promise.resolve({ data: rows, meta: EMPTY_PAGE.meta });
    return Promise.resolve(EMPTY_PAGE);
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: viewer });
  render(
    <QueryClientProvider client={client}>
      <ViewerSeatActions course={served} />
      <Toaster />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ViewerSeatActions', () => {
  it('renders a withdrawal for the seat the viewer holds themselves', async () => {
    renderSeat(course('PENDING'), STUDENT, [row()]);

    expect(await screen.findByRole('heading', { name: 'Your place' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  it('never renders it to a TEACHER holding that same row, which is what the Gate decides', async () => {
    // The payload here is one the server would NOT send: `viewerEnrollmentStatus` is
    // null for every non-student (courses.service.ts:329), so in production this
    // section is unreachable for a teacher. That makes the `Gate` the SECOND line
    // rather than the first, and this is the only shape that reaches it — so it is
    // the only place the second line can be seen working.
    renderSeat(course('PENDING'), TEACHER, [
      row({ student: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null } }),
    ]);

    await screen.findByRole('heading', { name: 'Your place' });
    // `enrollment:withdraw` is a bare `deny` for TEACHER (policy.ts:231), and the
    // card renders nothing at all — no disabled button, no empty dialog.
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('never renders it for a seat that belongs to somebody else on the roster', async () => {
    // The same course, the same payload status — but the list the self-scoped
    // endpoint served names a DIFFERENT student. "Holds a row on this course" is not
    // the test; "holds THIS row" is.
    renderSeat(course('PENDING'), STUDENT, [
      row({
        student: {
          id: '01JGXDFAM0K2Z1GYCSNM5F5RE9',
          name: 'Ben Ruiz',
          role: 'STUDENT',
          avatarUrl: null,
        },
      }),
    ]);

    await waitFor(() =>
      expect(apiGet.mock.calls.some(([path]) => path === '/enrollments')).toBe(true),
    );
    expect(screen.queryByRole('heading', { name: 'Your place' })).toBeNull();
  });

  it('refuses to send a reason the schema will not take', async () => {
    const user = userEvent.setup();
    renderSeat(course('PENDING'), STUDENT, [row()]);

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    const textbox = within(dialog).getByRole('textbox');
    await user.click(textbox);
    await user.paste('a'.repeat(501));

    // `withdrawEnrollmentSchema` caps at 500. The button that would be answered 422
    // is disabled rather than sent — the arrangement `RejectDialog` uses.
    expect(within(dialog).getByRole('button', { name: 'Withdraw' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});
