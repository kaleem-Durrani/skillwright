/**
 * Written FROM THE CONTRACT, before the component existed.
 *
 * Every query below is one a user could make — a role and an accessible name —
 * never a class name and never a test id. Where the contract leaves a choice open
 * (a Radix Select or a native one; a file input the user tabs to or one behind a
 * labelled button) the helpers accept either, because the contract names the
 * BEHAVIOUR and a test that pinned the widget would be asserting an implementation
 * detail it was told not to read.
 *
 * The network is stubbed at `@/lib/api` — the one client this SPA talks to our API
 * through (api.ts:98-108). `lib/uploads.ts` presigns and commits through that same
 * client, so this stub covers both halves of an upload without this file knowing
 * anything about how `uploadFile` is assembled. The direct-to-object-store PUT rides
 * `XMLHttpRequest` by contract (it is where `upload.onprogress` lives — Phase 5 of the
 * UI roadmap), so `XMLHttpRequest` is stubbed the same way `lib/uploads.test.ts`
 * stubs it; `fetch` stays stubbed as a tripwire, since nothing in this dialog has a
 * reason to call it at all.
 */
import type { ReactElement } from 'react';
import type { SessionUser } from '@/lib/session';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UPLOAD_LIMITS } from '@skillwright/shared/schema';
import { qk } from '@/lib/query';
import type { ResourceDto } from '@/lib/types';

/** The api client's send signature, minus the generic the callers use. */
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
  /*
   * The real module's other exports are kept — `API_BASE` and the pagination types
   * are innocent, and only `api` needs replacing. `Record<string, unknown>` rather
   * than `typeof import(...)` because @typescript-eslint/consistent-type-imports
   * forbids an inline `import()` type here; nothing in this file reads an export
   * off `actual`, so the looser shape costs nothing.
   */
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: apiPut, del: apiDel },
  };
});

// Imported after the mock so the component resolves the stubbed client.
import { ResourceFormDialog } from './ResourceFormDialog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * ULIDs, not readable strings: `idSchema` accepts a cuid or a ULID and nothing else
 * (common.ts:20-22), and `createResourceSchema.courseId` is an `idSchema`. A form
 * that validates its own body client-side would refuse a fixture id like 'course-1'
 * and the submit test would fail for a reason that has nothing to do with the form.
 */
const COURSE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const RESOURCE_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const AUTHOR_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';
const UPLOAD_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';
const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD1';

/** Matches `SessionUser` (session.ts:60-69), which is what `useSession` hands out. */
const VIEWER: SessionUser = {
  id: VIEWER_ID,
  email: 'teacher@example.edu',
  name: 'Dana Okafor',
  role: 'TEACHER',
  status: 'ACTIVE',
  provenance: 'PASSWORD',
  avatarUrl: null,
  totpEnabled: false,
};

/** An upload-backed row: the case where the file behind it CANNOT be swapped. */
const EXISTING_RESOURCE: ResourceDto = {
  id: RESOURCE_ID,
  title: 'Week 3 handbook',
  description: 'The printable version of the week three notes.',
  type: 'DOCUMENT',
  courseId: COURSE_ID,
  courseName: 'Structural Analysis',
  author: { id: AUTHOR_ID, name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
  isPublic: true,
  uploadId: UPLOAD_ID,
  externalUrl: null,
  sizeBytes: 482_000,
  contentType: 'application/pdf',
  commentCount: 0,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const RESOURCE_LIMIT = UPLOAD_LIMITS.RESOURCE;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

beforeAll(() => {
  /**
   * jsdom implements none of the pointer-capture API, and Radix's Select calls all
   * three while it decides whether a pointer gesture is a click or a drag. Without
   * them, opening the type list throws before any assertion runs. This is harness
   * plumbing of the same kind vitest.setup.ts already does for ResizeObserver.
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
    return Promise.resolve({ ...EXISTING_RESOURCE, id: RESOURCE_ID });
  });
  apiPatch.mockResolvedValue(EXISTING_RESOURCE);

  // A fetch that reaches here means something bypassed the api client AND the XHR
  // transport. No test in this file wants one.
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
  /*
   * Seeded rather than fetched. The dialog is opened from a screen that already
   * knows who the viewer is, and any `useSession` read inside it should resolve
   * from cache — no test here is about a session round trip.
   */
  client.setQueryData(qk.session, { user: VIEWER });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function openDialog(
  resource?: ResourceDto,
): Promise<{ user: UserEvent; dialog: HTMLElement }> {
  const user = userEvent.setup();
  renderDialog(
    <ResourceFormDialog
      open
      onOpenChange={vi.fn()}
      courseId={COURSE_ID}
      {...(resource ? { resource } : {})}
    />,
  );
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

// ---------------------------------------------------------------------------
// Widget-agnostic accessors
// ---------------------------------------------------------------------------

function titleField(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('textbox', { name: /title/i });
}

function descriptionField(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('textbox', { name: /description/i });
}

function typeControl(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('combobox', { name: /type|kind|format/i });
}

/** A URL field is a textbox whose label says so — 'URL', 'Link', 'Web address'. */
function urlField(dialog: HTMLElement): HTMLElement | null {
  return within(dialog).queryByRole('textbox', { name: /url|link|address/i });
}

/**
 * A file picker IS `input[type="file"]` — that is not an implementation detail, it
 * is the only control a browser offers for choosing a file. It is queried by type
 * rather than by role because HTML-AAM gives a file input no role at all, so
 * `getByRole` cannot see one.
 */
function filePicker(dialog: HTMLElement): HTMLInputElement | null {
  const node = dialog.querySelector('input[type="file"]');
  return node instanceof HTMLInputElement ? node : null;
}

function requireFilePicker(dialog: HTMLElement): HTMLInputElement {
  const node = filePicker(dialog);
  if (!node) throw new Error('The dialog rendered no file picker.');
  return node;
}

/** The submit control, however it is labelled: type="submit" first, then wording. */
function submitButton(dialog: HTMLElement): HTMLElement {
  const typed = dialog.querySelector('button[type="submit"]');
  if (typed instanceof HTMLElement) return typed;
  return within(dialog).getByRole('button', { name: /add|create|save|publish|upload/i });
}

/** Drive the type control from the keyboard, native `<select>` or Radix alike. */
async function chooseType(user: UserEvent, dialog: HTMLElement, label: RegExp): Promise<void> {
  const control = typeControl(dialog);

  if (control instanceof HTMLSelectElement) {
    await user.selectOptions(control, within(control).getByRole('option', { name: label }));
    return;
  }

  control.focus();
  await user.keyboard('{Enter}');
  // Radix portals its listbox to the document body, so this is a screen-wide query.
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = entry;
  return out;
}

/** Every POST this test cares about, keyed by the path the api client was given. */
function postsTo(pattern: RegExp): Array<Record<string, unknown>> {
  return apiPost.mock.calls
    .filter(([path]) => pattern.test(path))
    .map(([, body]) => asRecord(body));
}

// ---------------------------------------------------------------------------
// The object store, as an XHR stand-in
// ---------------------------------------------------------------------------

/**
 * A minimal `XMLHttpRequest` double holding the PUT open until a test completes it —
 * the same shape `lib/uploads.test.ts` drives, because both files talk to the same
 * transport. It exposes exactly what `putToStore` touches: open/setRequestHeader/send,
 * `upload.onprogress`, `onload`, `onerror`.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  upload: {
    onprogress:
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = {
    onprogress: null,
  };
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

  /** Fire progress events as a browser would, then complete (or fail) the request. */
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
    this.responseText = '';
    this.onload?.();
  }
}

/** The PUT `uploadFile` opened, once the presign round trip has landed. */
async function sentPut(): Promise<FakeXhr> {
  await vi.waitFor(() => {
    if (FakeXhr.instances.length === 0) throw new Error('no XHR was created');
  });
  const request = FakeXhr.instances.at(-1);
  if (request === undefined) throw new Error('no XHR was created');
  return request;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResourceFormDialog', () => {
  it('asks for a URL and offers no file picker when the type is LINK', async () => {
    const { user, dialog } = await openDialog();

    await chooseType(user, dialog, /link/i);

    expect(urlField(dialog)).toBeInTheDocument();
    expect(filePicker(dialog)).toBeNull();
  });

  it('swaps the URL field for a file picker when the type becomes DOCUMENT', async () => {
    const { user, dialog } = await openDialog();

    await chooseType(user, dialog, /link/i);
    expect(urlField(dialog)).toBeInTheDocument();

    await chooseType(user, dialog, /document/i);

    expect(filePicker(dialog)).toBeInTheDocument();
    // A URL field left behind would let someone submit both sources at once, which
    // `createResourceSchema`'s exactly-one refinement (resource.ts:39-63) refuses.
    expect(urlField(dialog)).toBeNull();
  });

  it('states the accepted types and the size limit before a file is chosen', async () => {
    const { user, dialog } = await openDialog();

    await chooseType(user, dialog, /document/i);
    const picker = requireFilePicker(dialog);

    // Nothing selected yet: this is guidance, not the report of a rejection.
    expect(picker.files?.length ?? 0).toBe(0);

    // 512 MB — `UPLOAD_LIMITS.RESOURCE.maxBytes` in the units a person reads.
    expect(RESOURCE_LIMIT.maxBytes).toBe(512 * 1024 * 1024);
    expect(dialog).toHaveTextContent(/512\s*MB/i);
    // A concrete format the user can check their file against. 'pdf' also matches a
    // raw `application/pdf` listing; 'mp4' matches an extension list.
    expect(dialog.textContent ?? '').toMatch(/pdf|mp4/i);
  });

  it('refuses an oversized file inline, before anything is uploaded or created', async () => {
    const { user, dialog } = await openDialog();

    // A valid title first, so the only thing standing between this form and a
    // submission is the file. Otherwise "did not submit" would prove nothing.
    await user.type(titleField(dialog), 'Structural analysis handbook');
    await chooseType(user, dialog, /document/i);

    const picker = requireFilePicker(dialog);
    const file = new File(['%PDF-1.7'], 'handbook.pdf', { type: 'application/pdf' });
    /*
     * The size is redefined rather than really allocated: 512 MB of ArrayBuffer in
     * jsdom is not worth the seconds, and `describeFileProblem` reads `file.size`,
     * which is exactly what a real 600 MB file would present.
     */
    Object.defineProperty(file, 'size', { value: 600 * 1024 * 1024, configurable: true });

    await user.upload(picker, file);
    // user-event applies the input's own `accept` filter. If this is 0 the file was
    // filtered out and the failure below would be reported against the wrong cause.
    expect(picker.files?.length ?? 0).toBe(1);

    /*
     * FormField renders its error as `role="status"` with a polite live region
     * (FormField.tsx:117-129), which is what makes a field error inline AND
     * announced. `role="alert"` is accepted as the assertive equivalent.
     */
    const problem = await waitFor(() => {
      const node = dialog.querySelector('[role="status"], [role="alert"]');
      if (!(node instanceof HTMLElement) || (node.textContent ?? '').trim() === '') {
        throw new Error('No inline message appeared for the rejected file.');
      }
      return node;
    });
    expect(problem.textContent ?? '').toMatch(/512|large|big|exceed|maximum|limit/i);

    await user.click(submitButton(dialog));

    // Neither half of the upload, and no row: the contract's "before a round trip".
    await waitFor(() => {
      expect(postsTo(/uploads/)).toHaveLength(0);
      expect(postsTo(/resources/)).toHaveLength(0);
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('creates a LINK with an externalUrl and no uploadId', async () => {
    const { user, dialog } = await openDialog();

    await chooseType(user, dialog, /link/i);
    await user.type(titleField(dialog), 'Reading list');

    const url = urlField(dialog);
    if (!url) throw new Error('The LINK branch rendered no URL field.');
    await user.type(url, 'https://example.edu/reading-list');

    await user.click(submitButton(dialog));

    await waitFor(() => expect(postsTo(/resources/)).toHaveLength(1));
    const [body] = postsTo(/resources/);
    if (!body) throw new Error('the LINK branch POSTed nothing');

    expect(body).toMatchObject({
      courseId: COURSE_ID,
      title: 'Reading list',
      type: 'LINK',
      externalUrl: 'https://example.edu/reading-list',
    });
    // `null` and absent both read as "no upload" to the exactly-one refinement
    // (resource.ts:47-49); a present id would be refused for a LINK.
    expect(body.uploadId ?? null).toBeNull();

    // A LINK never touches the object store.
    expect(postsTo(/uploads/)).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('pre-fills from the resource being edited and never offers to replace its file', async () => {
    const { dialog } = await openDialog(EXISTING_RESOURCE);

    expect(titleField(dialog)).toHaveValue(EXISTING_RESOURCE.title);
    expect(descriptionField(dialog)).toHaveValue(EXISTING_RESOURCE.description);

    const type = typeControl(dialog);
    const selected = type instanceof HTMLSelectElement ? type.value : (type.textContent ?? '');
    expect(selected).toMatch(/document/i);

    expect(within(dialog).getByRole('checkbox')).toBeChecked();

    /*
     * The one thing an edit must not pretend it can do. `updateResourceSchema` has
     * no `uploadId` (resource.ts:78-89), so a picker here would collect a file the
     * PATCH cannot carry.
     */
    expect(filePicker(dialog)).toBeNull();
  });

  it('gives every control an accessible name and a keyboard route to it', async () => {
    const { user, dialog } = await openDialog();
    await chooseType(user, dialog, /document/i);

    const stops: HTMLElement[] = [];
    for (let step = 0; step < 24; step += 1) {
      await user.tab();
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body) break;
      // Radix parks focus on a guard span for a tick while it wraps the trap.
      if (active.hasAttribute('data-radix-focus-guard')) continue;
      if (stops.includes(active)) break; // the trap has cycled: every stop is seen
      stops.push(active);
    }

    expect(stops.length).toBeGreaterThan(0);
    for (const stop of stops) {
      expect(stop).toHaveAccessibleName();
    }

    for (const control of [
      titleField(dialog),
      descriptionField(dialog),
      typeControl(dialog),
      within(dialog).getByRole('checkbox'),
      submitButton(dialog),
    ]) {
      expect(stops).toContain(control);
    }

    /*
     * The picker itself is usually the tab stop, but a visually-hidden input driven
     * by a labelled button is equally operable — so either satisfies this. What is
     * NOT acceptable is a picker with no keyboard route at all.
     */
    const picker = requireFilePicker(dialog);
    const viaButton = stops.some((stop) =>
      /file|upload|choose|browse|attach|select/i.test(
        `${stop.getAttribute('aria-label') ?? ''} ${stop.textContent ?? ''}`,
      ),
    );
    expect(stops.includes(picker) || viaButton).toBe(true);
    expect(picker).toHaveAccessibleName();
  });

  it('surfaces real PUT progress while uploading, then posts the committed id', async () => {
    const { user, dialog } = await openDialog();

    await user.type(titleField(dialog), 'Structural analysis handbook');
    await chooseType(user, dialog, /document/i);

    const picker = requireFilePicker(dialog);
    // Small but really a PDF: the resolver runs `describeFileProblem` on the choice,
    // so the type has to be one the limits accept.
    const file = new File(['%PDF-1.7'], 'handbook.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 8, configurable: true });
    await user.upload(picker, file);
    expect(picker.files?.length ?? 0).toBe(1);

    await user.click(submitButton(dialog));

    // The upload is in flight: presign has run, the PUT is held open by the fake, and
    // the bar is mounted at zero before any byte is measured.
    const put = await sentPut();
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(dialog.textContent ?? '').toMatch(/uploading handbook\.pdf/i);

    // Half the bytes measured off the wire: the bar moves to what was measured —
    // asserted here rather than after completion, because completing the PUT lets the
    // submit finish and take the bar down again.
    put.upload.onprogress?.({ loaded: 4, total: 8, lengthComputable: true });
    await waitFor(() =>
      expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50'),
    );
    expect(dialog.textContent ?? '').toMatch(/handbook\.pdf — 50%/i);

    // Completion: commit runs only after the PUT answered 200, and the row carries its id.
    put.finish({ status: 200 });
    await waitFor(() => expect(postsTo(/uploads\/commit/)).toHaveLength(1));
    const [body] = postsTo(/resources/);
    expect(body).toMatchObject({ courseId: COURSE_ID, uploadId: UPLOAD_ID });

    // Settled: the submit is over, so the step-specific bar is gone again.
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).toBeNull());

    // The store transport is XHR; fetch stays a tripwire nothing here trips.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
