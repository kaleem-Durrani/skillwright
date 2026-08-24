/**
 * Pins the Phase 6 slice on the catalogue: a card whose course names a
 * prerequisite says so, and goes quiet again once THIS viewer has completed it.
 *
 * The line is data about the COURSE, so it shows to every viewer whose completion
 * is not decidable (anonymous, teachers, admins); only the signed-in student's own
 * `GET /enrollments` answer can retire it. Harness as in Announcements.test.tsx:
 * network stubbed at `@/lib/api`, session seeded into the cache, route module
 * mocked down to `Route.useSearch`, TanStack `Link` degraded to the anchor it
 * would have produced.
 */
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import type { CourseListItem } from '@/lib/types';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, searchMock, navigateSpy } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  searchMock: vi.fn<() => Record<string, unknown>>(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/courses', () => ({
  Route: { useSearch: () => searchMock(), fullPath: '/courses' },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    Link: ({
      to,
      params,
      children,
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
    }) => <a href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? '')}>{children}</a>,
  };
});

// Imported after the mocks so the page resolves the stubbed client and route.
import { CoursesPage } from './Courses.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const RUNG_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD9';

/** The intake every catalogue row carries since Phase 9 — soonest-start first. */
function offering(overrides: Partial<CourseListItem['offerings'][number]> = {}) {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RC3',
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

function viewerAs(role: SessionUser['role']): SessionUser {
  return { ...VIEWER, role };
}

function listItem(overrides: Partial<CourseListItem> = {}): CourseListItem {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RDA',
    code: 'WELD-101',
    slug: 'welding-fundamentals',
    name: 'Welding Fundamentals',
    department: { id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' },
    teacher: { id: TEACHER_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    duration: { value: 6, unit: 'WEEK' },
    publishedAt: '2026-08-01T09:00:00.000Z',
    description: 'Strikes, beads and safety.',
    offerings: [offering()],
    prerequisiteCourseId: null,
    prerequisite: null,
    ...overrides,
  };
}

const GATED_ROW = listItem({
  prerequisiteCourseId: RUNG_ID,
  prerequisite: { id: RUNG_ID, code: 'SMAW-100', name: 'SMAW Level 1' },
});

const UNGATED_ROW = listItem({
  id: '01JGXDFAM0K2Z1GYCSNM5F5RDB',
  code: 'MIG-110',
  name: 'MIG Welding I',
});

function page(rows: CourseListItem[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 20, total: rows.length, totalPages: 1, hasNext: false, hasPrev: false },
  };
}

const EMPTY_PAGE = page([]);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  searchMock.mockReturnValue({ page: 1 });
});

/**
 * @param enrolled what `GET /enrollments?status=APPROVED` answers for the viewer.
 * Loose on purpose — it reaches the stubbed client verbatim, and only
 * `lib/policy.ts`'s mapping (`row.course.id`) ever reads it.
 */
function renderCatalogue(user: SessionUser, enrolled: { data: unknown[] }): void {
  apiGet.mockImplementation((path) => {
    if (String(path).startsWith('/courses')) return Promise.resolve(page([GATED_ROW, UNGATED_ROW]));
    if (String(path).startsWith('/enrollments')) return Promise.resolve(enrolled);
    return Promise.reject(new Error(`unexpected GET ${String(path)}`));
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user });
  render(
    <QueryClientProvider client={client}>
      <CoursesPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Courses catalogue — Phase 6 prerequisite badges', () => {
  it('badges a card whose rung the signed-in student has not completed yet', async () => {
    renderCatalogue(VIEWER, EMPTY_PAGE);

    expect(await screen.findByText('Requires: SMAW-100 SMAW Level 1')).toBeInTheDocument();
    // The ungated row beside it stays quiet.
    expect(screen.queryByText('Requires: WELD-101')).toBeNull();
  });

  it('retires the badge once the student holds an APPROVED seat on the rung', async () => {
    renderCatalogue(VIEWER, {
      data: [{ id: '01JGXDFAM0K2Z1GYCSNM5F5RDC', course: { id: RUNG_ID } }],
    });

    // DataList renders every row in BOTH its mobile card and its md+ table, so
    // the loaded state is observed on all matching links, not one.
    await screen.findAllByRole('link', { name: 'Welding Fundamentals' });
    await waitFor(() => expect(screen.queryByText('Requires: SMAW-100 SMAW Level 1')).toBeNull());
  });

  it('shows the requirement to viewers whose completion is not decidable', async () => {
    // A teacher's `GET /enrollments` says nothing about completed rungs, so the
    // factual line stays; the endpoint is never even asked (student-scoped).
    renderCatalogue(viewerAs('TEACHER'), EMPTY_PAGE);

    expect(await screen.findByText('Requires: SMAW-100 SMAW Level 1')).toBeInTheDocument();
    const enrollmentCalls = apiGet.mock.calls.filter(([path]) =>
      String(path).startsWith('/enrollments'),
    );
    expect(enrollmentCalls).toHaveLength(0);
  });
});
