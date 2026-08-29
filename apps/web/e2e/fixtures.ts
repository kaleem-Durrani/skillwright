import type { Page } from '@playwright/test';

/**
 * A stubbed API for the e2e suite.
 *
 * These specs assert things about the built SPA — that it boots, that its
 * dialogs are reachable and accessible — none of which needs a live backend.
 * Routing every `/api/v1/**` call here keeps the suite runnable in CI with no
 * Postgres, no Redis and no seed, which is the only reason it can gate a push.
 *
 * Shapes are copied from `@skillwright/shared`'s response schemas. If one drifts
 * the page renders an error state and the spec that depends on it fails loudly,
 * which is the intended failure mode: a stub that silently satisfies a changed
 * contract would be worse than no stub.
 */

const nowIso = '2026-08-25T10:00:00.000Z';

export const department = (n: number) => ({
  id: `dep-${n}`,
  name: `Department ${n}`,
  slug: `department-${n}`,
});

export const userDetails = (n: number, role: string) => ({
  id: `u-${n}`,
  name: `Person ${n}`,
  role,
  avatarUrl: null,
  email: `person${n}@skillwright.dev`,
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: nowIso,
  teacherProfile: null,
  studentProfile: null,
});

const offering = () => ({
  id: 'off-1',
  startDate: nowIso,
  endDate: null,
  capacity: 20,
  workshopCapacity: 8,
  approvedCount: 2,
  seatsRemaining: 18,
  isFull: false,
  workshopSeatsRemaining: 6,
  viewerEnrollmentStatus: null,
});

export const courseDetail = {
  id: 'c-1',
  code: 'WELD-101',
  slug: 'course-1',
  name: 'Welding Fundamentals 1',
  description: 'A course.',
  department: department(1),
  teacher: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  duration: { value: 6, unit: 'WEEK' },
  publishedAt: nowIso,
  syllabusUploadId: null,
  syllabusUrl: null,
  resourceCount: 1,
  prerequisiteCourseId: null,
  prerequisite: null,
  offerings: [offering()],
  createdAt: nowIso,
  updatedAt: nowIso,
};

const resource = {
  id: 'r-1',
  title: 'Safety handbook',
  description: null,
  type: 'DOCUMENT',
  courseId: 'c-1',
  courseName: courseDetail.name,
  author: { id: 'u-1', name: 'Person 1', role: 'TEACHER', avatarUrl: null },
  isPublic: false,
  uploadId: 'up-1',
  externalUrl: null,
  sizeBytes: 1024,
  contentType: 'application/pdf',
  commentCount: 0,
  createdAt: nowIso,
  updatedAt: nowIso,
};

export const paginated = (data: unknown[]) => ({
  data,
  meta: { page: 1, limit: 50, total: data.length, totalPages: 1, hasNext: false, hasPrev: false },
});

/** Sign the browser in as an admin and answer every list the screens ask for. */
export async function stubApi(page: Page): Promise<void> {
  // Nothing in the app reads the socket yet, and an open attempt keeps the
  // network non-idle forever, so `networkidle` never settles without this.
  await page.route('**/socket.io/**', (route) => route.abort());

  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/auth/me')
      return json({
        actor: { id: 'u-1', role: 'ADMIN', status: 'ACTIVE', provenance: 'LOCAL' },
        user: userDetails(1, 'ADMIN'),
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
    if (path === '/dashboard/stats')
      return json({ courses: 3, pendingEnrollments: 1, unreadMessages: 0, resources: 5 });
    if (path === '/departments') return json(paginated([department(1), department(2)]));
    if (path === '/users')
      return json(paginated([userDetails(1, 'TEACHER'), userDetails(2, 'STUDENT')]));
    if (path === '/courses') return json(paginated([courseDetail]));
    if (path === '/courses/c-1') return json(courseDetail);
    if (path === '/courses/c-1/resources') return json(paginated([resource]));

    // Everything else is a list the screen may ask for but no assertion reads.
    return json(paginated([]));
  });
}
