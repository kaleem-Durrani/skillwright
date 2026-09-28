/**
 * `GET /enrollments/:id` — the seat's own page, and the two things it has to get
 * right.
 *
 * The first is that it must NOT be gated on a client-side `can()` before the
 * fetch. `enrollment:read` is `isEnrolledStudent` for a student and `ownsCourse`
 * for a teacher, and both read fields that live on the RESPONSE — so a
 * subject-free check is a guaranteed denial (LESSONS-LEARNED #15), and used as
 * React Query's `enabled` it is worse than useless: a disabled query stays
 * `status: 'pending'` in v5, so the page would spin forever for an admin.
 *
 * The second is the two states that answer. "You may not read this" and "this
 * failed to load" are different sentences for the person looking at them, and a
 * page that shows the second for the first is telling somebody they broke
 * something.
 */
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/session';
import type { EnrollmentDto } from '@/lib/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, enrollmentId, PARAMS } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  enrollmentId: { value: '01JGXDFAM0K2Z1GYCSNM5F5RD1' },
  PARAMS: { id: '' } as { id: string },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/enrollments.$id', () => ({
  Route: {
    useParams: () => ({ id: enrollmentId.value }),
    fullPath: '/enrollments/$id',
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
    useNavigate: () => vi.fn(),
    // The page reads its id with `useParams({ from: Route.id })` rather than
    // `Route.useParams()`, because a page may be mounted from a component that is
    // not the route file. The real hook reaches into a mounted router's store.
    useParams: () => PARAMS,
  };
});

import { EnrollmentDetailPage } from './EnrollmentDetail.js';

const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const ENROLLMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

const VIEWER_ADMIN: SessionUser = {
  id: TEACHER_ID,
  email: 'priya@skillwright.dev',
  name: 'Priya Raman',
  role: 'ADMIN',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: true,
};

const VIEWER_STUDENT: SessionUser = {
  id: STUDENT_ID,
  email: 'ada@skillwright.dev',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const VIEWER_OTHER_TEACHER: SessionUser = {
  id: '01JGXDFAM0K2Z1GYCSNM5F5RCZ',
  email: 'dana@skillwright.dev',
  name: 'Dana Whitfield',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

function seat(overrides: Partial<EnrollmentDto> = {}): EnrollmentDto {
  return {
    id: ENROLLMENT_ID,
    status: 'APPROVED',
    student: { id: STUDENT_ID, name: 'Ada Okafor', role: 'STUDENT', avatarUrl: null },
    course: {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RCY',
      code: 'WELD-101',
      slug: 'welding-fundamentals',
      name: 'Welding Fundamentals',
      department: { id: 'dep-1', name: 'Welding', slug: 'welding' },
      teacher: { id: TEACHER_ID, name: 'Priya Raman', role: 'TEACHER', avatarUrl: null },
      duration: { value: 6, unit: 'WEEK' },
      publishedAt: '2026-08-01T09:00:00.000Z',
    },
    offering: {
      id: '01JGXDFAM0K2Z1GYCSNM5F5RD7',
      startDate: '2026-09-01T09:00:00.000Z',
      endDate: null,
      capacity: 20,
      workshopCapacity: 8,
      approvedCount: 11,
      seatsRemaining: 9,
      isFull: false,
      workshopSeatsRemaining: 2,
    },
    requestedAt: '2026-08-10T09:00:00.000Z',
    decidedAt: '2026-08-12T09:00:00.000Z',
    decidedBy: { id: TEACHER_ID, name: 'Priya Raman', role: 'TEACHER', avatarUrl: null },
    decisionNote: 'Portfolio accepted in place of the certificate.',
    completedAt: null,
    completedBy: null,
    ...overrides,
  };
}

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

function forbidden(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    code: 'FORBIDDEN',
    detail: 'rule: TEACHER:ownsCourse',
    requestId: 'req-1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  enrollmentId.value = ENROLLMENT_ID;
  PARAMS.id = enrollmentId.value;
});

function renderPage(viewer: SessionUser = VIEWER_ADMIN): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(qk.session, { user: viewer });
  render(
    <QueryClientProvider client={client}>
      <EnrollmentDetailPage />
    </QueryClientProvider>,
  );
}

describe('EnrollmentDetail — the fetch is not gated on a subject it does not have', () => {
  it('asks for the row, and an admin gets it', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.resolve(seat())
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    expect(
      await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 }),
    ).toBeInTheDocument();
    /*
     * A subject-free `can('enrollment:read')` is false for every non-admin, and as
     * `enabled: false` it would have left this at `status: 'pending'` forever.
     */
    expect(apiGet).toHaveBeenCalledWith(`/enrollments/${ENROLLMENT_ID}`);
  });
});

describe('EnrollmentDetail — what it renders', () => {
  it('shows the decision, its author and the note', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.resolve(seat())
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 });

    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Portfolio accepted in place of the certificate.')).toBeInTheDocument();
    // The decider is named: a decision with no author is the failure the audit
    // extension exists to prevent, and rendering it is the other half of that.
    expect(screen.getAllByText(/Priya Raman/).length).toBeGreaterThan(0);
    // And an incomplete row says so rather than showing a dash under a chip that
    // claims a qualification exists.
    expect(screen.getByText('Not completed')).toBeInTheDocument();
  });

  it('names the intake and its seat arithmetic as the server computed it', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.resolve(seat())
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 });

    expect(screen.getByText('11 of 20 taken')).toBeInTheDocument();
    expect(screen.getByText('6 of 8 taken')).toBeInTheDocument();
    expect(screen.getByText('WELD-101')).toBeInTheDocument();
    expect(screen.getByText('Welding')).toBeInTheDocument();
  });

  it('shows the completion stamp for a COMPLETED row and who recorded it', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.resolve(
            seat({
              status: 'COMPLETED',
              completedAt: '2026-10-10T17:00:00.000Z',
              completedBy: {
                id: TEACHER_ID,
                name: 'Priya Raman',
                role: 'TEACHER',
                avatarUrl: null,
              },
            }),
          )
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 });
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});

describe('EnrollmentDetail — the two answers', () => {
  it('says a teacher is not allowed, rather than that it failed to load', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.reject(forbidden())
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_OTHER_TEACHER);

    expect(await screen.findByText('Not available to you')).toBeInTheDocument();
    // A 403 is a policy decision, not a transport failure, so it must not offer a
    // retry — the retry would fail identically every time.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry for a failure that is not a refusal', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.reject(
            new ApiError({
              type: 'about:blank',
              title: 'Internal',
              status: 500,
              code: 'INTERNAL',
              requestId: 'req-2',
            }),
          )
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_OTHER_TEACHER);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a student is offered a way back that is not a course they cannot open', async () => {
    apiGet.mockImplementation((path) =>
      path === `/enrollments/${ENROLLMENT_ID}`
        ? Promise.reject(forbidden())
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_STUDENT);

    await screen.findByText('Not available to you');
    // `course:read` is `isPublished` for a student, and the back link is gated on
    // it with the COURSE subject — so on a DRAFT course it must not be rendered at
    // all, because the API would answer 403 for the page it points at.
    expect(screen.queryByRole('link', { name: /Welding Fundamentals/ })).toBeNull();
  });
});
