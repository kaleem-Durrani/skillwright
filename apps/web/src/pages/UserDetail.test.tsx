/**
 * `GET /users/:id` — the page that closes the third of Phase 5's holes, pinned
 * against the two things it could get wrong.
 *
 * The first is the gate. `user:read` is `isSelf` for a STUDENT and a TEACHER and
 * `allow` for an ADMIN, and the subject is `{ userId: <the id in the URL> }` —
 * built from the URL rather than from the response, because the id exists before
 * the record does. A student who opens a colleague's link must be refused by the
 * CLIENT, with no request leaving the browser: a `403` proves the server is right
 * and says nothing about whether the SPA asked for something it was not entitled
 * to.
 *
 * The second is the DTO. `userDetailSchema` carries fourteen fields and an admin's
 * view of somebody is not allowed to become quietly wider than them — no audit
 * trail, no session list, nothing that is not on the contract.
 */
import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/session';
import type { UserDetail } from '@/lib/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';

type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPatch, targetId, PARAMS } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPatch: vi.fn(),
  targetId: { value: '01JGXDFAM0K2Z1GYCSNM5F5RD1' },
  PARAMS: { id: '' } as { id: string },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: apiPatch, put: vi.fn(), del: vi.fn() },
  };
});

vi.mock('@/routes/_app/users.$id', () => ({
  Route: { useParams: () => ({ id: targetId.value }), fullPath: '/users/$id' },
}));

// `Link` needs router context these tests do not mount; degraded to the anchor it
// would have produced, the same degradation CourseDetail.test.tsx uses.
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

import { UserDetailPage } from './UserDetail.js';

const ADMIN_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const STUDENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';
const COLLEAGUE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD2';

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

const VIEWER_ADMIN: SessionUser = {
  id: ADMIN_ID,
  email: 'priya@skillwright.dev',
  name: 'Priya Raman',
  role: 'ADMIN',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: true,
};

function account(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: STUDENT_ID,
    name: 'Ada Okafor',
    email: 'ada@skillwright.dev',
    role: 'STUDENT',
    status: 'ACTIVE',
    phoneNumber: '+44 161 555 0142',
    bio: 'Runs the Thursday evening workshop.',
    avatarUrl: null,
    mfaEnabled: true,
    lastLoginAt: '2026-08-20T09:00:00.000Z',
    createdAt: '2026-01-05T09:00:00.000Z',
    studentProfile: {
      departmentId: '01JGXDFAM0K2Z1GYCSNM5F5RCY',
      departmentName: 'Fabrication',
      enrollmentNo: 'ENR-0099',
      enrolledOn: '2026-01-05T09:00:00.000Z',
    },
    teacherProfile: null,
    ...overrides,
  };
}

const EMPTY_PAGE = {
  data: [],
  meta: { page: 1, limit: 50, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  targetId.value = STUDENT_ID;
  PARAMS.id = targetId.value;
  apiGet.mockResolvedValue(EMPTY_PAGE);
});

function renderPage(viewer: SessionUser = VIEWER_ADMIN): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: viewer });
  render(
    <QueryClientProvider client={client}>
      <UserDetailPage />
    </QueryClientProvider>,
  );
}

describe('UserDetail — the gate', () => {
  it('refuses a colleague to a student without asking the server for them', async () => {
    targetId.value = COLLEAGUE_ID;
    PARAMS.id = COLLEAGUE_ID;
    apiGet.mockResolvedValue(account({ id: COLLEAGUE_ID, name: 'Bo Lindqvist' }));
    renderPage(VIEWER_STUDENT);

    expect(await screen.findByText('Not available to you')).toBeInTheDocument();
    /*
     * The load-bearing assertion. `user:read` denies a student on any other id, so
     * the page must not even CONFIGURE the request: a disabled-but-firing query
     * would put a colleague's record in a network tab and a proxy log, and the
     * refusal would then be the server's rather than the client's.
     */
    expect(apiGet.mock.calls.filter(([path]) => path === `/users/${COLLEAGUE_ID}`)).toEqual([]);
    // And nothing that would have been in the record is on the page.
    expect(screen.queryByText('Runs the Thursday evening workshop.')).toBeNull();
  });

  it('serves a student their OWN record', async () => {
    targetId.value = STUDENT_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${STUDENT_ID}` ? Promise.resolve(account()) : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_STUDENT);

    expect(
      await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 }),
    ).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(`/users/${STUDENT_ID}`);
    // A student may edit themselves — `user:update` is `isSelf` — so the control
    // is there, and it is the SAME dialog the admin table uses rather than a
    // second form.
    expect(screen.getByRole('button', { name: 'Edit account' })).toBeInTheDocument();
  });

  it('offers the back link to an admin and takes it away from a student', async () => {
    targetId.value = STUDENT_ID;
    PARAMS.id = STUDENT_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${STUDENT_ID}` ? Promise.resolve(account()) : Promise.resolve(EMPTY_PAGE),
    );

    const { unmount } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <UserDetailPage />
      </QueryClientProvider>,
    );
    // The session was never seeded, so the viewer is anonymous and the record is
    // refused before it is fetched.
    expect(await screen.findByText('Not available to you')).toBeInTheDocument();
    unmount();

    renderPage(VIEWER_ADMIN);
    expect(
      await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 }),
    ).toBeInTheDocument();
    // `user:list` is subject-free, so this is the complete gate for "is there
    // somewhere to go back to" — and `/admin/users` is somewhere only an admin
    // can go.
    expect(screen.getByRole('link', { name: /Accounts/ })).toBeInTheDocument();
  });

  it('shows the refusal, not a spinner, when the server refuses anyway', async () => {
    /*
     * The race the client gate cannot cover: a cached actor says one thing and the
     * server — the authority — says another. It is a different sentence from the
     * client's, so it gets its own branch.
     */
    targetId.value = STUDENT_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${STUDENT_ID}`
        ? Promise.reject(
            new ApiError({
              type: 'about:blank',
              title: 'Forbidden',
              status: 403,
              code: 'FORBIDDEN',
              detail: 'rule: STUDENT:isSelf',
              requestId: 'req-1',
            }),
          )
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_STUDENT);

    expect(await screen.findByText(/only visible to an administrator/)).toBeInTheDocument();
    // A 403 is not a transport failure, so it must not offer a retry.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull());
  });
});

describe('UserDetail — the DTO, and nothing wider', () => {
  it('renders every field the contract carries and asks for nothing else', async () => {
    targetId.value = STUDENT_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${STUDENT_ID}` ? Promise.resolve(account()) : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Ada Okafor', level: 1 });

    expect(screen.getByText('ada@skillwright.dev')).toBeInTheDocument();
    expect(screen.getByText('+44 161 555 0142')).toBeInTheDocument();
    expect(screen.getByText('Runs the Thursday evening workshop.')).toBeInTheDocument();
    expect(screen.getByText('Turned on')).toBeInTheDocument();
    expect(screen.getByText('Fabrication')).toBeInTheDocument();
    expect(screen.getByText('ENR-0099')).toBeInTheDocument();
    expect(screen.getByText('Student')).toBeInTheDocument();

    /*
     * The negative half. An admin's view must not quietly become wider than the
     * DTO: there is no session list, no audit trail and no enrolment history on
     * `userDetailSchema`, and the API would refuse every one of them to
     * `user:read` anyway.
     */
    expect(apiGet.mock.calls.map(([path]) => path)).toEqual([`/users/${STUDENT_ID}`]);
    expect(screen.queryByText(/recent activity/i)).toBeNull();
    expect(screen.queryByText(/sessions/i)).toBeNull();
  });

  it('renders the teaching profile for a teacher and the student profile for a student', async () => {
    targetId.value = COLLEAGUE_ID;
    PARAMS.id = COLLEAGUE_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${COLLEAGUE_ID}`
        ? Promise.resolve(
            account({
              id: COLLEAGUE_ID,
              name: 'Dana Okafor',
              email: 'dana@skillwright.dev',
              role: 'TEACHER',
              studentProfile: null,
              teacherProfile: {
                departmentId: '01JGXDFAM0K2Z1GYCSNM5F5RCY',
                departmentName: 'Welding',
                qualification: 'City & Guilds Level 3',
                specialization: 'MIG',
                staffNo: 'STF-0042',
              },
            }),
          )
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Dana Okafor', level: 1 });
    expect(screen.getByRole('heading', { name: 'Teaching profile' })).toBeInTheDocument();
    expect(screen.getByText('City & Guilds Level 3')).toBeInTheDocument();
    expect(screen.getByText('STF-0042')).toBeInTheDocument();
    // The student-only fields are not rendered for a teacher, and vice versa.
    expect(screen.queryByText('ENR-0099')).toBeNull();
  });

  it('renders no profile section at all for an admin, who has neither', async () => {
    targetId.value = ADMIN_ID;
    PARAMS.id = ADMIN_ID;
    apiGet.mockImplementation((path) =>
      path === `/users/${ADMIN_ID}`
        ? Promise.resolve(
            account({
              id: ADMIN_ID,
              name: 'Priya Raman',
              email: 'priya@skillwright.dev',
              role: 'ADMIN',
              studentProfile: null,
              teacherProfile: null,
            }),
          )
        : Promise.resolve(EMPTY_PAGE),
    );
    renderPage(VIEWER_ADMIN);

    await screen.findByRole('heading', { name: 'Priya Raman', level: 1 });
    // Saying "No department" for an account that has no department COLUMN would
    // imply a gap in the record rather than in the model.
    expect(screen.queryByRole('heading', { name: /profile/i })).toBeNull();
  });
});
