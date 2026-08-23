/**
 * Pins the publish AFFORDANCE's wiring, in isolation from any screen:
 *
 * - it exists exactly when policy allows `course:publish` for the subject
 *   `ownsCourse` reads (`{ courseTeacherId }`) — a teacher who owns the course
 *   sees it, a student does not;
 * - clicking sends the EXPLICIT `{ published: boolean }` body to
 *   `POST /courses/:id/publish`, never an absent one — the route now tolerates a
 *   bodyless POST, and this control must not depend on that tolerance.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, apiPut, apiDel } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
  apiPut: vi.fn<ApiSend>(),
  apiDel: vi.fn<ApiFetch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: apiPut, del: apiDel },
  };
});

// Imported after the mock so the component resolves the stubbed client.
import { CoursePublishButton } from './CoursePublishButton.js';

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const OWNER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: OWNER_ID,
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

function renderButton(options: {
  course: { id: string; publishedAt: string | null; teacherId: string };
  session?: SessionUser;
}): HTMLElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: options.session ?? viewer() });
  const { container } = render(
    <QueryClientProvider client={client}>
      <CoursePublishButton course={options.course} />
    </QueryClientProvider>,
  );
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({});
  apiPost.mockResolvedValue({});
});

describe('CoursePublishButton', () => {
  it('offers Publish for a draft whose teacher is the viewer, and posts the explicit body', async () => {
    const user = userEvent.setup();
    const container = renderButton({
      course: { id: COURSE_ID, publishedAt: null, teacherId: OWNER_ID },
    });

    const button = await screen.findByRole('button', { name: /^publish$/i });
    expect(button).toBeInTheDocument();

    await user.click(button);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/courses/${COURSE_ID}/publish`);
    // The whole point of this affordance: the verb states its intent every time.
    expect(body).toEqual({ published: true });
    expect(container.textContent).toMatch(/publish/i);
  });

  it('offers Unpublish for a live course, posting { published: false }', async () => {
    const user = userEvent.setup();
    renderButton({
      course: { id: COURSE_ID, publishedAt: '2026-08-01T09:00:00.000Z', teacherId: OWNER_ID },
    });

    const button = await screen.findByRole('button', { name: /unpublish/i });
    await user.click(button);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [, body] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).toEqual({ published: false });
  });

  it('renders nothing for a student, whom the policy row denies outright', async () => {
    const container = renderButton({
      course: { id: COURSE_ID, publishedAt: null, teacherId: OWNER_ID },
      session: viewer({ id: '01JGXDFAM0K2Z1GYCSNM5F5RD1', role: 'STUDENT' }),
    });

    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing for a teacher who does not own the course', async () => {
    const container = renderButton({
      course: {
        id: COURSE_ID,
        publishedAt: null,
        teacherId: '01JGXDFAM0K2Z1GYCSNM5F5RD2',
      },
      session: viewer(),
    });

    // `ownsCourse` reads the subject's courseTeacherId and compares it to the actor;
    // a mismatch denies exactly like an absence of the field.
    expect(container.querySelector('button')).toBeNull();
  });
});
