/**
 * The brief picker, tested from the contract rather than from the widget.
 *
 * `Assignment.resourceId` is a nullable column with an `onDelete: SetNull` foreign key
 * and a server-side `assertBriefUsable`, and the form could not set it. The decision
 * this file pins down is not "which control" — it is the three questions the residual
 * left open, each of which is a wire fact:
 *
 *   1. A brief is OPTIONAL, on create and on edit. Detaching travels as an explicit
 *      `null`, never as an omitted key, because `updateAssignmentSchema` reads the
 *      difference as two different intentions and a client that cannot say them
 *      cannot use it.
 *   2. Picking is possible on EDIT, and a save that did not touch the picker must
 *      NOT send the key at all. Otherwise editing a title would detach a brief the
 *      teacher never went near, through the one path where nothing looks wrong.
 *   3. A brief that has left the course's resources must still render as the
 *      CURRENT value rather than as an empty control.
 *
 * Nothing here asks the client what the viewer may read. The options are whatever
 * `GET /courses/:courseId/resources` returns, under the SAME query key the Resources
 * tab already reads, and the one test that mounts both together asserts they cost
 * one request rather than two.
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import type { ResourceDto } from '@/lib/types';

/** The api client's send signature, minus the generic the callers use. */
type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, api: { get: apiGet, post: apiPost, patch: apiPatch, del: vi.fn() } };
});

// Imported after the mock so the component resolves the stubbed client.
import { AssignmentFormDialog } from './AssignmentFormDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * ULIDs rather than readable strings, because `idSchema` accepts a cuid or a ULID and
 * nothing else. A fixture id like 'course-1' would be refused by any schema in the
 * chain, and the test would fail for a reason that has nothing to do with the picker.
 */
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCA';
const OFFERING_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCB';
const RESOURCE_A = '01JGXDFAM0K2Z1GYCSNM5F5RCC';
const RESOURCE_B = '01JGXDFAM0K2Z1GYCSNM5F5RCD';
/** A resource that is still referenced by a task but is not in the course's list. */
const RESOURCE_GONE = '01JGXDFAM0K2Z1GYCSNM5F5RCE';
const ASSIGNMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCF';
const AUTHOR_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';

const DUE_AT = '2026-09-01T09:00:00.000Z';

function resource(id: string, title: string): ResourceDto {
  return {
    id,
    title,
    description: null,
    type: 'DOCUMENT',
    courseId: COURSE_ID,
    courseName: 'Structural Analysis',
    author: { id: AUTHOR_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    isPublic: false,
    uploadId: '01JGXDFAM0K2Z1GYCSNM5F5RD1',
    externalUrl: null,
    sizeBytes: 482_000,
    contentType: 'application/pdf',
    commentCount: 0,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  };
}

const RESOURCES = [
  resource(RESOURCE_A, 'Fillet weld worksheet'),
  resource(RESOURCE_B, 'Section drawing'),
];

/** One page, which is the envelope the endpoint answers with. */
function page<T>(data: T[], total = data.length): { data: T[]; meta: Record<string, unknown> } {
  return {
    data,
    meta: { page: 1, limit: 20, total, totalPages: 1, hasNext: false, hasPrev: false },
  };
}

const SAVED_ASSIGNMENT = {
  id: ASSIGNMENT_ID,
  offeringId: OFFERING_ID,
  title: 'Weld the fillet',
  brief: 'Two runs, 6mm fillet, uphill.',
  dueAt: DUE_AT,
  maxScore: 100,
  resourceId: null as string | null,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

function existing(overrides: Record<string, unknown> = {}) {
  return { ...SAVED_ASSIGNMENT, ...overrides };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeAll(() => {
  /*
   * jsdom implements none of the pointer-capture API and Radix's Select calls all
   * three while it decides whether a pointer gesture is a click or a drag. The same
   * shim `ResourceFormDialog.test.tsx` installs, for the same reason.
   */
  for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(Element.prototype, name, {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue(page(RESOURCES));
  apiPost.mockResolvedValue(SAVED_ASSIGNMENT);
  apiPatch.mockResolvedValue(existing());
});

function renderDialog(ui: ReactElement): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      /*
       * `staleTime` mirrors `createQueryClient`'s 30 seconds rather than a test's
       * zero, because that value is what turns "one cache entry" into "one
       * request" in the real app. Testing the dedupe under a staleTime the
       * production client does not use would be asserting a property the app
       * does not have.
       */
      queries: { retry: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

function dialogFor(assignment?: ReturnType<typeof existing>): ReactElement {
  return (
    <AssignmentFormDialog
      open
      onOpenChange={vi.fn()}
      offeringId={OFFERING_ID}
      courseId={COURSE_ID}
      defaultDueAt={DUE_AT}
      {...(assignment ? { assignment } : {})}
    />
  );
}

async function openDialog(assignment?: ReturnType<typeof existing>): Promise<{
  user: UserEvent;
  dialog: HTMLElement;
}> {
  const user = userEvent.setup();
  renderDialog(dialogFor(assignment));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

function briefControl(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('combobox', { name: /file|attach/i });
}

/** Drive the picker from the keyboard, so no test assumes a native `<select>`. */
async function choose(user: UserEvent, dialog: HTMLElement, label: RegExp): Promise<void> {
  const control = briefControl(dialog);
  // The trigger is disabled while the course's resources are in flight, and a
  // disabled trigger swallows the keystroke that opens the list.
  await waitFor(() => {
    expect(control).toBeEnabled();
  });
  control.focus();
  await user.keyboard('{Enter}');
  // Radix portals its listbox to the document body, so this is a screen-wide query.
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
  await waitFor(() => {
    expect(briefControl(dialog)).toHaveTextContent(label);
  });
}

function field(dialog: HTMLElement, name: RegExp): HTMLElement {
  return within(dialog).getByRole('textbox', { name });
}

function submitButton(dialog: HTMLElement): HTMLElement {
  const typed = dialog.querySelector('button[type="submit"]');
  if (typed instanceof HTMLElement) return typed;
  return within(dialog).getByRole('button', { name: /set task|save changes/i });
}

/** Fill the controls the resolver requires, leaving the picker alone. */
async function fillRequired(user: UserEvent, dialog: HTMLElement): Promise<void> {
  await user.clear(field(dialog, /title/i));
  await user.type(field(dialog, /title/i), 'Weld the fillet');
  await user.clear(field(dialog, /the task/i));
  await user.type(field(dialog, /the task/i), 'Two runs, 6mm fillet, uphill.');
  await user.clear(field(dialog, /out of/i));
  await user.type(field(dialog, /out of/i), '100');
}

function sentBody(mock: typeof apiPost | typeof apiPatch): Record<string, unknown> {
  return (sentCall(mock)[1] ?? {}) as Record<string, unknown>;
}

/** The last call a stub recorded, or a thrown error rather than an undefined index. */
function sentCall(mock: typeof apiPost | typeof apiPatch): [string, unknown] {
  const calls = mock.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('The dialog made no request.');
  return last as [string, unknown];
}

// ---------------------------------------------------------------------------
// The reuse claim
// ---------------------------------------------------------------------------

describe('the picker reads the endpoint the course page already answers', () => {
  it('asks for the course resources by the path the Resources tab uses', async () => {
    await openDialog();
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(`/courses/${COURSE_ID}/resources`);
    });
  });

  it('costs ONE request with the course page mounted beside it', async () => {
    /*
     * A picker that fetched the same list under a different key would be a second
     * answer to `resource:read` — the thing lesson 28 is about — and it would drift
     * the moment the policy changed. Sharing `qk.courseResources` is what makes it
     * the same answer rather than a copy, so the dedupe IS the assertion.
     */
    function CourseResourcesReader(): ReactElement {
      useQuery({
        queryKey: qk.courseResources(COURSE_ID),
        queryFn: () => api.get(`/courses/${COURSE_ID}/resources`),
      });
      return <div>the resources tab</div>;
    }

    renderDialog(
      <>
        <CourseResourcesReader />
        {dialogFor()}
      </>,
    );
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalled();
    });

    const resourceCalls = apiGet.mock.calls.filter(([path]) =>
      String(path).startsWith(`/courses/${COURSE_ID}/resources`),
    );
    expect(resourceCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A brief is OPTIONAL
// ---------------------------------------------------------------------------

describe('a brief is optional', () => {
  it('is not marked required, and says so with its accessible name', async () => {
    /*
     * `FormField` appends a screen-reader-only "(required)" INSIDE the label, so the
     * accessible name is where optionality is actually observable. Every other
     * control on this form is required, so a document-wide check would find four
     * hits and prove nothing about the picker.
     */
    const { dialog } = await openDialog();
    await waitFor(() => {
      expect(briefControl(dialog)).toBeInTheDocument();
    });
    expect(briefControl(dialog)).toHaveAccessibleName(/^Attached file$/);
  });

  it('starts a new task on "no file" rather than on a blank control', async () => {
    const { dialog } = await openDialog();
    await waitFor(() => {
      expect(briefControl(dialog)).toHaveTextContent(/^No file/);
    });
  });

  it('creates a task with no file, sending an explicit null', async () => {
    const { user, dialog } = await openDialog();
    await fillRequired(user, dialog);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalled();
    });
    expect(sentCall(apiPost)[0]).toBe(`/offerings/${OFFERING_ID}/assignments`);
    expect(sentBody(apiPost)).toMatchObject({ resourceId: null });
  });

  it('creates a task with the file the teacher chose', async () => {
    const { user, dialog } = await openDialog();
    await fillRequired(user, dialog);
    await choose(user, dialog, /Fillet weld worksheet/);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalled();
    });
    expect(sentBody(apiPost)).toMatchObject({ resourceId: RESOURCE_A });
  });
});

// ---------------------------------------------------------------------------
// Picking on EDIT
// ---------------------------------------------------------------------------

describe('the brief is editable after the task is set', () => {
  it('seeds the picker with the brief already attached', async () => {
    const { dialog } = await openDialog(existing({ resourceId: RESOURCE_A }));
    await waitFor(() => {
      expect(briefControl(dialog)).toHaveTextContent(/Fillet weld worksheet/);
    });
  });

  it('swaps one attached brief for another', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: RESOURCE_A }));
    await choose(user, dialog, /Section drawing/);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    expect(sentCall(apiPatch)[0]).toBe(`/assignments/${ASSIGNMENT_ID}`);
    expect(sentBody(apiPatch)).toMatchObject({ resourceId: RESOURCE_B });
  });

  it('detaches with an explicit null when the teacher clears it', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: RESOURCE_A }));
    await choose(user, dialog, /^No file/);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    // `null` and "absent" are different intentions to `updateAssignmentSchema`;
    // sending absent here would silently leave the brief attached.
    expect(sentBody(apiPatch)).toHaveProperty('resourceId', null);
  });

  it('sends no resourceId at all when the picker was never touched', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: RESOURCE_A }));
    const title = field(dialog, /title/i);
    await user.clear(title);
    await user.type(title, 'Weld the fillet (revised)');

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    // The save is about the title. Emitting the unchanged id would be harmless today
    // and a silent detach the day the picker is ever seeded from a different source.
    expect(sentBody(apiPatch)).not.toHaveProperty('resourceId');
  });

  it('attaches a brief to a task that had none', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: null }));
    await choose(user, dialog, /Section drawing/);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    expect(sentBody(apiPatch)).toMatchObject({ resourceId: RESOURCE_B });
  });
});

// ---------------------------------------------------------------------------
// A brief that is no longer among the course's resources
// ---------------------------------------------------------------------------

describe('a brief the course list no longer carries', () => {
  it('still shows as the current value instead of rendering an empty control', async () => {
    /*
     * `DELETE /resources/:id` is a SOFT delete, so the foreign key's `SetNull` never
     * fires for it: the task keeps pointing at a row that is filtered out of
     * `GET /courses/:courseId/resources`. A picker that only rendered the list would
     * show a blank trigger, and the teacher would read "no file" for a task that
     * still has one.
     */
    const { dialog } = await openDialog(existing({ resourceId: RESOURCE_GONE }));
    await waitFor(() => {
      expect(briefControl(dialog)).toHaveTextContent(/no longer/i);
    });
  });

  it('can still be detached from there', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: RESOURCE_GONE }));
    await choose(user, dialog, /^No file/);

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    expect(sentBody(apiPatch)).toHaveProperty('resourceId', null);
  });

  it('leaves it alone on a save that changes something else', async () => {
    const { user, dialog } = await openDialog(existing({ resourceId: RESOURCE_GONE }));
    const title = field(dialog, /title/i);
    await user.clear(title);
    await user.type(title, 'Weld the fillet (revised)');

    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    expect(sentBody(apiPatch)).not.toHaveProperty('resourceId');
  });
});

// ---------------------------------------------------------------------------
// The server's answer, not the client's
// ---------------------------------------------------------------------------

describe('refusals come from the server', () => {
  it('shows the message the API returned on the resourceId path', async () => {
    /*
     * `assertBriefUsable` answers 422 with a field path, and the form maps paths it
     * knows onto controls. Before the picker this string had nowhere to land and was
     * dropped, which is what made a legitimate refusal look like a form that
     * silently did nothing.
     */
    apiPatch.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Validation failed',
        status: 422,
        code: 'VALIDATION_FAILED',
        requestId: 'req-1',
        errors: [{ path: 'resourceId', message: 'That resource is not yours to attach.' }],
      }),
    );

    const { user, dialog } = await openDialog(existing({ resourceId: null }));
    await choose(user, dialog, /Fillet weld worksheet/);
    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(within(dialog).getByText('That resource is not yours to attach.')).toBeInTheDocument();
    });
  });

  it('does not block the task on a failed lookup — the brief stays optional', async () => {
    apiGet.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        requestId: 'req-2',
      }),
    );

    const { user, dialog } = await openDialog();
    await fillRequired(user, dialog);
    await user.click(submitButton(dialog));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalled();
    });
    expect(sentBody(apiPost)).toMatchObject({ resourceId: null });
  });
});

// ---------------------------------------------------------------------------
// The list is a page
// ---------------------------------------------------------------------------

describe('when the course has more resources than one page carries', () => {
  it('says how many it is showing rather than implying it is all of them', async () => {
    apiGet.mockResolvedValue(page(RESOURCES, 34));

    const { dialog } = await openDialog();

    await waitFor(() => {
      expect(within(dialog).getByText(/2 of 34/)).toBeInTheDocument();
    });
  });
});
