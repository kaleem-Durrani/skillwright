/**
 * Written against the CONTRACT, in the shape of ResourceFormDialog.test.tsx:
 * queries a user could make (role + accessible name), the network stubbed at the
 * one client this SPA talks through, and `lib/uploads.ts` covered by the same
 * stub because it presigns and commits through that client. A PUT reaching the
 * stubbed global `fetch` means an upload started when no test wanted one.
 *
 * What THIS file exists to pin, beyond the shared dialog contract:
 * - create and edit are different FORMS: code and slug exist on create only,
 *   because `updateCourseSchema` accepts neither (course.ts:120-135);
 * - the syllabus picker validates against the SYLLABUS purpose's own limits
 *   before any round trip;
 * - an edit PATCHes only what changed.
 */
import type { SessionUser } from '@/lib/session';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UPLOAD_LIMITS } from '@skillwright/shared/schema';
import { qk } from '@/lib/query';
import type { CourseDetail } from '@/lib/types';

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
import { CourseFormDialog } from './CourseFormDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const TEACHER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

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

const EXISTING_COURSE: CourseDetail = {
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
  publishedAt: null,
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: null,
  syllabusUploadId: null,
  syllabusUrl: null,
  resourceCount: 0,
  viewerEnrollmentStatus: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  apiGet.mockImplementation((path: string) => {
    if (path.includes('/departments')) {
      return Promise.resolve({
        data: [{ id: DEPARTMENT_ID, name: 'Welding', slug: 'welding' }],
        meta: {},
      });
    }
    // The detail fetch the edit form makes for itself.
    return Promise.resolve(EXISTING_COURSE);
  });
  apiPost.mockResolvedValue({ ...EXISTING_COURSE });
  apiPatch.mockResolvedValue({ ...EXISTING_COURSE });

  // A PUT that reaches here means an upload started. No test in this file wants one.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: new Headers() }),
    ),
  );
});

async function openDialog(
  options: {
    course?: Pick<CourseDetail, 'id'> & Partial<Pick<CourseDetail, 'name' | 'code' | 'slug'>>;
    session?: SessionUser;
  } = {},
): Promise<HTMLElement> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: options.session ?? viewer() });
  render(
    <QueryClientProvider client={client}>
      <CourseFormDialog
        open
        onOpenChange={vi.fn()}
        {...(options.course ? { course: options.course } : {})}
      />
    </QueryClientProvider>,
  );
  const dialog = await screen.findByRole('dialog');
  // In edit mode the controls stay blank until the detail fetch lands; every test
  // below needs them seeded.
  await waitFor(() =>
    expect(within(dialog).getByRole('textbox', { name: /name/i })).not.toBeDisabled(),
  );
  await waitFor(() => expect(within(dialog).queryByText(/loading/i)).toBeNull());
  return dialog;
}

function submitButton(dialog: HTMLElement): HTMLElement {
  const typed = dialog.querySelector('button[type="submit"]');
  if (typed instanceof HTMLElement) return typed;
  return within(dialog).getByRole('button', { name: /add|save/i });
}

/** Every POST/PATCH body this file cares about, keyed by the path given. */
function bodiesOf(
  calls: ReadonlyArray<readonly unknown[]>,
  pattern: RegExp,
): Array<Record<string, unknown>> {
  return calls
    .filter(([path]) => pattern.test(String(path)))
    .map(([, body]) => body as Record<string, unknown>);
}

/** What a caller needs to compare the picker's copy against, in bytes. */
const SYLLABUS_LIMIT = UPLOAD_LIMITS.SYLLABUS;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CourseFormDialog — create vs edit fields', () => {
  it('offers code and web address inputs when creating', async () => {
    const dialog = await openDialog();

    expect(within(dialog).getByRole('textbox', { name: /^code/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /web address/i })).toBeInTheDocument();
  });

  it('shows code and slug as read-only facts on edit, never as inputs', async () => {
    const dialog = await openDialog({
      course: { id: COURSE_ID, name: EXISTING_COURSE.name },
    });

    // updateCourseSchema accepts neither field — an input here could only ever
    // produce a 422, so the edit form shows them as text instead.
    expect(within(dialog).queryByRole('textbox', { name: /^code/i })).toBeNull();
    expect(within(dialog).queryByRole('textbox', { name: /web address/i })).toBeNull();
    expect(dialog).toHaveTextContent('WELD-101');
    expect(dialog).toHaveTextContent(/welding-fundamentals/);
    expect(dialog).toHaveTextContent(/cannot change after creation/i);
  });
});

describe('CourseFormDialog — validation paths', () => {
  it('refuses a malformed code on create with the schema’s own sentence, before any POST', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    await user.type(within(dialog).getByRole('textbox', { name: /^code/i }), 'weld');
    await user.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Mig Welding Basics');

    await user.click(submitButton(dialog));

    const problem = await waitFor(() => {
      const node = dialog.querySelector('[role="status"]');
      if (!(node instanceof HTMLElement) || node.textContent === '') {
        throw new Error('No inline message appeared for the rejected code.');
      }
      return node.textContent ?? '';
    });
    expect(problem).toMatch(/code like WELD-101|uppercase/i);
    expect(bodiesOf(apiPost.mock.calls, /courses/)).toHaveLength(0);
  });

  it('does not offer a slug to refuse on edit: the PATCH carries only what changed', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog({
      course: { id: COURSE_ID, name: EXISTING_COURSE.name },
    });

    const name = within(dialog).getByRole('textbox', { name: /name/i });
    await user.clear(name);
    await user.type(name, 'Advanced Welding Practice');

    await user.click(submitButton(dialog));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [path, body] = apiPatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toContain(COURSE_ID);
    expect(body).toEqual({ name: 'Advanced Welding Practice' });
    expect(Object.keys(body)).not.toContain('code');
    expect(Object.keys(body)).not.toContain('slug');
    // Untouched fields are omitted, so saving a name can never blank a description.
    expect(Object.keys(body)).not.toContain('description');
  });
});

describe('CourseFormDialog — syllabus upload', () => {
  it('states the SYLLABUS limits before a file is chosen', async () => {
    const dialog = await openDialog();

    expect(SYLLABUS_LIMIT.maxBytes).toBe(20 * 1024 * 1024);
    expect(dialog.textContent ?? '').toMatch(/20\s*MB/i);
    expect(dialog.textContent ?? '').toMatch(/pdf/i);
  });

  it('refuses an oversized file inline, before anything is presigned', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog();

    const picker = dialog.querySelector('input[type="file"]');
    if (!(picker instanceof HTMLInputElement)) throw new Error('No file picker rendered.');
    const file = new File(['%PDF-1.7'], 'syllabus.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 40 * 1024 * 1024, configurable: true });

    await user.upload(picker, file);

    const problem = await waitFor(() => {
      const node = dialog.querySelector('[role="status"]');
      if (!(node instanceof HTMLElement) || (node.textContent ?? '').trim() === '') {
        throw new Error('No inline message appeared for the rejected file.');
      }
      return node.textContent ?? '';
    });
    expect(problem).toMatch(/20\s*MB|largest|too big|large/i);

    await user.click(submitButton(dialog));
    await waitFor(() => expect(postsTo(/uploads/)).toHaveLength(0));
    expect(postsTo(/courses/)).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  function postsTo(pattern: RegExp): Array<Record<string, unknown>> {
    return bodiesOf([...apiPost.mock.calls], pattern);
  }
});
