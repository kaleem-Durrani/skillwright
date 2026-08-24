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
import { render, screen } from '@testing-library/react';
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
    isFull: false,
    publishedAt: '2026-08-01T09:00:00.000Z',
    startDate: '2026-09-01T09:00:00.000Z',
    endDate: null,
    syllabusUploadId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
    syllabusUrl: SIGNED_SYLLABUS_URL,
    resourceCount: 0,
    viewerEnrollmentStatus: 'APPROVED',
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
