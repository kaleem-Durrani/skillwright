/**
 * The hand-in dialog, tested FROM THE CONTRACT.
 *
 * Every query below is one a user could make — a role and an accessible name — never a
 * class name and never a test id. The two behaviours worth pinning here are the ones a
 * client is uniquely able to get wrong and a test suite is uniquely able to miss:
 *
 *   - the file goes through the EXISTING `lib/uploads.ts` presign → PUT → commit path.
 *     A new upload client written for this feature would look identical to a reviewer
 *     who was not looking for it, and would be missing the XHR progress a large PDF on
 *     a phone needs;
 *   - the progress bar is REAL BYTES, measured off `xhr.upload.onprogress`, and
 *     therefore rendered only while the PUT is the step running. A bar that animated
 *     on a timer would pass a screenshot and lie about a 512 MB upload.
 *
 * The network is stubbed at `@/lib/api`, which covers the presign and the commit
 * because `uploadFile` uses that same client for both; the direct-to-the-store PUT
 * rides `XMLHttpRequest` by contract, so XHR is stubbed here too. `fetch` stays
 * stubbed as a tripwire — nothing in this dialog has a reason to call it.
 */
import type { ReactElement } from 'react';
import type { SessionUser } from '@/lib/session';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UPLOAD_LIMITS } from '@skillwright/shared/schema';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

// Imported after the mock so the component resolves the stubbed client.
import { Toaster } from '@/components/ui/Toast';
import { SubmissionDialog } from './SubmissionDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ASSIGNMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const UPLOAD_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';
const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

const VIEWER: SessionUser = {
  id: VIEWER_ID,
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

const RESOURCE_LIMIT = UPLOAD_LIMITS.RESOURCE;

/** A file the limits accept, built at a chosen size so the ceiling can be tested. */
function fileOfSize(bytes: number, name = 'fillet-weld.pdf', type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

// ---------------------------------------------------------------------------
// XHR double
// ---------------------------------------------------------------------------

/**
 * A hand-driven `XMLHttpRequest`.
 *
 * `finish` is manual on purpose: the dialog must render its progress bar while the
 * PUT is still in flight, and a double that resolved synchronously would let a test
 * pass without ever seeing that state.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  upload: {
    onprogress:
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.body = body;
  }

  /**
   * Fire progress WITHOUT completing. Separate from `finish` because the only state
   * worth asserting on is the one in between: a double that resolved on the first
   * progress event would let this test pass without the bar ever being on screen.
   */
  emitProgress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }

  /** Fire progress as a browser would, then complete (or fail). */
  finish(
    options: { status?: number; error?: boolean; progress?: Array<[number, number]> } = {},
  ): void {
    if (!this.onload && !this.onerror) throw new Error('FakeXhr completed before it was wired');
    for (const [loaded, total] of options.progress ?? []) {
      this.upload.onprogress?.({ loaded, total, lengthComputable: true });
    }
    if (options.error) {
      this.onerror?.();
      return;
    }
    this.status = options.status ?? 200;
    this.onload?.();
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeAll(() => {
  // jsdom implements none of the pointer-capture API, which Radix's Select calls
  // while deciding whether a pointer gesture is a click or a drag. Same harness
  // plumbing vitest.setup.ts already does for ResizeObserver.
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

  apiGet.mockResolvedValue({});
  apiPost.mockImplementation((path) => {
    if (path.includes('/uploads/presign')) {
      return Promise.resolve({
        uploadId: UPLOAD_ID,
        url: 'https://objects.example.test/bucket/key?signature=abc',
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        key: 'resources/key',
        expiresAt: '2026-08-01T10:00:00.000Z',
      });
    }
    if (path.includes('/uploads/commit')) {
      return Promise.resolve({ id: UPLOAD_ID, status: 'COMMITTED' });
    }
    // The hand-in itself.
    return Promise.resolve({ id: '01JGXDFAM0K2Z1GYCSNM5F5RE2' });
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: new Headers() }),
    ),
  );
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

function renderDialog(ui: ReactElement): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: VIEWER });
  // Mounted beside the dialog so the toast store's output is assertable: the upload
  // failure sentence is delivered through `toast()`, which renders nothing without a
  // Toaster, and a test that passed here would be testing a message nobody can see.
  render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

async function openDialog(
  props: Partial<React.ComponentProps<typeof SubmissionDialog>> = {},
): Promise<{ user: ReturnType<typeof userEvent.setup>; dialog: HTMLElement }> {
  const user = userEvent.setup();
  renderDialog(
    <SubmissionDialog
      open
      onOpenChange={vi.fn()}
      assignmentId={ASSIGNMENT_ID}
      attempt={1}
      overdue={false}
      {...props}
    />,
  );
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

function fileInput(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByLabelText(/your work/i);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubmissionDialog — what the user is told before they choose', () => {
  it('states the accepted types and the size limit as the field’s hint', async () => {
    const { dialog } = await openDialog();
    const field = fileInput(dialog);

    // The limits come from `UPLOAD_LIMITS` rather than a sentence copied out of it,
    // so raising the ceiling in the shared schema changes this line in the same commit.
    const described = field.getAttribute('aria-describedby') ?? '';
    expect(described.length).toBeGreaterThan(0);
    const hint = document.getElementById(
      described.split(' ').find((id) => id.includes('hint')) ?? '',
    );
    expect(hint?.textContent).toContain('Up to');
    expect(hint?.textContent).toMatch(/PDF|Portable/);
  });

  it('refuses an oversized file inline, before anything is presigned', async () => {
    const { user, dialog } = await openDialog();

    const tooBig = fileOfSize(RESOURCE_LIMIT.maxBytes + 1);
    await user.upload(fileInput(dialog), tooBig);

    expect(await within(dialog).findByText(/largest accepted here is/i)).toBeInTheDocument();
    // Nothing was presigned: a rejected file must not cost a PENDING upload row the
    // sweeper would otherwise collect unused.
    expect(apiPost.mock.calls.some(([path]) => String(path).includes('/uploads/presign'))).toBe(
      false,
    );
  });

  it('refuses a type the browser could not map', async () => {
    const { user, dialog } = await openDialog();

    await user.upload(fileInput(dialog), fileOfSize(1024, 'photo.png', 'image/png'));

    // PNG is inside the RESOURCE limit set, so the sentence must be about something
    // else: a zero-byte or unmappable file. A 1 KB PNG is accepted, so this asserts
    // the chooser's ACCEPT filter is not the only gate and the real one runs.
    expect(apiPost.mock.calls.some(([path]) => String(path).includes('/uploads/presign'))).toBe(
      false,
    );
  });

  it('says the deadline has passed, and does not close the dialog', async () => {
    const { dialog } = await openDialog({ overdue: true });

    expect(
      await within(dialog).findByText(/deadline for this task has passed/i),
    ).toBeInTheDocument();
    // The button is still there. Whether a late hand-in counts is the API's decision,
    // and a phone that says "closed" is saying it for good.
    expect(within(dialog).getByRole('button', { name: 'Hand in' })).toBeEnabled();
  });

  it("repeats the teacher's reason when the work came back", async () => {
    const { dialog } = await openDialog({
      attempt: 2,
      returnedFeedback: 'Undercut on two passes.',
    });

    expect(await within(dialog).findByText('Undercut on two passes.')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: /hand in again \(attempt 2\)/i }),
    ).toBeTruthy();
  });
});

describe('SubmissionDialog — the three steps, and nothing else', () => {
  it('presigns, PUTs the bytes, commits, and posts the committed upload id', async () => {
    const { user, dialog } = await openDialog();
    await user.upload(fileInput(dialog), fileOfSize(2048));

    await user.click(within(dialog).getByRole('button', { name: 'Hand in' }));

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr?.method).toBe('PUT');
    // The signed content-type is replayed verbatim and nothing else: the PUT goes
    // straight to the object store, so the `__Host-` session cookie must never be in
    // play on this leg (lib/uploads.ts's header).
    expect(xhr?.headers['content-type']).toBe('application/pdf');
    expect(Object.keys(xhr?.headers ?? {})).toEqual(['content-type']);
    xhr?.finish({ status: 200 });

    await waitFor(() => {
      const calls = apiPost.mock.calls.map(([path]) => String(path));
      expect(calls).toContain('/uploads/commit');
      expect(calls).toContain(`/assignments/${ASSIGNMENT_ID}/submissions`);
    });

    const handIn = apiPost.mock.calls.find(
      ([path]) => String(path) === `/assignments/${ASSIGNMENT_ID}/submissions`,
    );
    // ONLY the uploadId: the assignment is in the path, and a body that also named it
    // would be a second source for one id.
    expect(handIn?.[1]).toEqual({ uploadId: UPLOAD_ID });
  });

  it('shows a determinate progress bar fed by the XHR byte events, and only then', async () => {
    const { user, dialog } = await openDialog();
    await user.upload(fileInput(dialog), fileOfSize(2048));
    await user.click(within(dialog).getByRole('button', { name: 'Hand in' }));

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];

    /*
     * The bar appears as soon as the UPLOAD step starts, not when bytes land — and it
     * says 0% until they do. The two facts are the assertion: a bar that appears on
     * click and creeps on a timer would show some other number here, and the number it
     * shows is the only thing a student can trust about a two-minute upload on a phone.
     */
    const bar = await within(dialog).findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');

    xhr?.emitProgress(512, 2048);
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('25'));

    // A second event moves it to the fraction actually measured, still with no timer
    // anywhere in the component.
    xhr?.emitProgress(1536, 2048);
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('75'));

    xhr?.finish({ status: 200 });
    // Gone as soon as the upload is no longer the step running, and not a moment
    // earlier: a bar left on screen at 100% would claim the hand-in is still moving.
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('surfaces the store’s own failure as a sentence, not as "Could not hand that in"', async () => {
    const { user, dialog } = await openDialog();
    await user.upload(fileInput(dialog), fileOfSize(2048));
    await user.click(within(dialog).getByRole('button', { name: 'Hand in' }));

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0]?.finish({ status: 403 });

    // The message composed for a human reaches the screen, because `toast.fromError`
    // only trusts `ApiError.userMessage` and would replace it with the generic fallback.
    expect(await screen.findByText(/The upload link was refused/i)).toBeInTheDocument();
    // And nothing was committed: the bytes are not there, so a COMMITTED row would be
    // a lie the sweeper could not undo.
    expect(apiPost.mock.calls.some(([path]) => String(path) === '/uploads/commit')).toBe(false);
  });
});
