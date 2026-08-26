/**
 * Written in the shape of ResourceFormDialog.test.tsx, against the same contract:
 * queries a user could make (role + accessible name), the network stubbed at the one
 * client this SPA talks through, and `lib/uploads.ts` covered by that stub because it
 * presigns and commits through it. The direct-to-object-store PUT rides
 * `XMLHttpRequest` (where `upload.onprogress` lives — Phase 5 of the UI roadmap), so a
 * PUT reaching `fetch` means something bypassed BOTH clients; `fetch` stays stubbed as
 * that tripwire, and a test asserting "nothing was sent" watches all three.
 *
 * What THIS file exists to pin, beyond the shared upload contract:
 * - the picker validates size and type BEFORE any round trip, so an unusable file
 *   costs no presign and writes no PENDING row;
 * - the current avatar comes from `/me` — including its DiceBear fallback, which is
 *   shown as-is rather than treated as "no avatar";
 * - the save path is busy while presign -> PUT -> commit -> PATCH runs;
 * - an upload failure toasts ITS OWN sentence (the `isUploadFailure` path), not the
 *   generic fallback, and everything else takes the `ApiError` path.
 */
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/problem';
import type { UserDetail } from '@/lib/types';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiPatch = (path: string, body?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch } = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiPatch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: vi.fn(), del: vi.fn() },
  };
});

/**
 * The toast store is module-level, so asserting on it directly is the honest way to
 * check WHICH sentence was raised. The real Radix viewport would only prove that
 * something appeared — not whether the upload's own copy survived `fromError`'s
 * fallback or was replaced by it, which is exactly what this suite pins.
 */
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    fromError: vi.fn(),
  }),
}));

vi.mock('@/components/ui/Toast', () => ({ toast: toastMock }));

/**
 * Radix's `Avatar.Image` mounts its `<img>` only after the browser reports a
 * successful load — jsdom never loads images, so the real primitive keeps every
 * face on the monogram fallback forever and there is no `src` to assert on.
 * The stub degrades the three primitives to the elements they render once an
 * image IS loaded, which is what "the picker shows this URL" means in jsdom.
 * Same degradation as this repo's TanStack `Link` stubs: href/`src` preserved,
 * behaviour the environment cannot produce dropped.
 */
vi.mock('@radix-ui/react-avatar', () => ({
  Root: (props: ComponentProps<'span'>) => <span {...props} />,
  Image: (props: ComponentProps<'img'>) => (
    // `alt` is spelled out for jsx-a11y/alt-text, which cannot see through a
    // spread; the component itself always passes an empty one.
    <img alt="" {...props} />
  ),
  Fallback: ({ delayMs: _delayMs, ...props }: ComponentProps<'span'> & { delayMs?: number }) => (
    <span {...props} />
  ),
}));

// Imported after the mocks so the component resolves the stubbed client.
import { AvatarPicker } from './AvatarPicker.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ULIDs — `idSchema` accepts a cuid or a ULID and nothing else. */
const VIEWER_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCX';
const UPLOAD_ID = '01JGXDFAM0K2Z1GYCSNM5F5RD0';

const DICEBEAR_URL =
  'https://api.dicebear.com/9.x/initials/svg?seed=Ada+Okafor&backgroundColor=b6e3f4';

/** A signed URL of the shape `/me` serves once an AVATAR upload is attached. */
const SIGNED_AVATAR_URL = 'https://objects.example.test/avatars/key?signature=xyz';

const PROFILE: UserDetail = {
  id: VIEWER_ID,
  email: 'student@example.edu',
  name: 'Ada Okafor',
  role: 'STUDENT',
  status: 'ACTIVE',
  phoneNumber: null,
  bio: null,
  // No upload yet: this is the generated fallback, served non-null by design.
  avatarUrl: DICEBEAR_URL,
  mfaEnabled: false,
  lastLoginAt: null,
  createdAt: '2026-08-01T09:00:00.000Z',
  teacherProfile: null,
  studentProfile: {
    departmentId: '01JGXDFAM0K2Z1GYCSNM5F5RCY',
    departmentName: 'Welding',
    enrollmentNo: 'S-2026-0042',
    enrolledOn: '2026-08-01T09:00:00.000Z',
  },
};

/** What PATCH /users/me answers after `updateSelf` accepted the upload. */
const UPDATED_PROFILE: UserDetail = { ...PROFILE, avatarUrl: SIGNED_AVATAR_URL };

const PRESIGN = {
  uploadId: UPLOAD_ID,
  url: 'https://objects.example.test/bucket/avatars/key?signature=abc',
  method: 'PUT' as const,
  headers: { 'content-type': 'image/jpeg' },
  key: 'avatars/key',
  expiresAt: '2026-08-01T10:00:00.000Z',
};

const COMMITTED = {
  id: UPLOAD_ID,
  key: 'avatars/key',
  bucket: 'bucket',
  contentType: 'image/jpeg',
  sizeBytes: 1024,
  originalName: 'face.jpg',
  status: 'COMMITTED',
  ownerId: VIEWER_ID,
  createdAt: '2026-08-01T09:00:00.000Z',
  committedAt: '2026-08-01T09:00:01.000Z',
};

/** A picture within the limits unless a test overrides it. */
function imageFile(overrides: { type?: string; size?: number } = {}): File {
  const file = new File(['not-really-jpeg-bytes'], 'face.jpg', {
    type: overrides.type ?? 'image/jpeg',
  });
  Object.defineProperty(file, 'size', { value: overrides.size ?? 1024, configurable: true });
  return file;
}

// ---------------------------------------------------------------------------
// The object store, as an XHR stand-in
// ---------------------------------------------------------------------------

/**
 * A minimal `XMLHttpRequest` double holding the PUT open until a test completes it —
 * the same shape `lib/uploads.test.ts` drives, because both files talk to the same
 * transport. No test here wants progress events; they exist on the fake only because
 * the real object does.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  upload = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(): void {}

  setRequestHeader(): void {}

  send(): void {}

  /** Complete (or fail) the held request as a browser would report it. */
  finish(options: { status?: number; error?: boolean } = {}): void {
    if (!this.onload && !this.onerror) throw new Error('FakeXhr completed before it was wired');
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
// Harness
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  apiGet.mockResolvedValue({});
  apiPost.mockImplementation((path) => {
    if (path.includes('/uploads/presign')) return Promise.resolve(PRESIGN);
    if (path.includes('/uploads/commit')) return Promise.resolve(COMMITTED);
    return Promise.resolve({});
  });
  apiPatch.mockResolvedValue(UPDATED_PROFILE);

  // A fetch that reaches here means something bypassed the api client AND the XHR
  // transport. Overridden per-test where a refusal is wanted on the PUT itself.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, statusText: 'OK', headers: new Headers() }),
    ),
  );
  FakeXhr.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

function renderPicker(profile: UserDetail = PROFILE): {
  user: UserEvent;
  onSaved: ReturnType<typeof vi.fn<(updated: UserDetail) => Promise<void>>>;
  rerenderWith: (next: UserDetail) => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSaved = vi.fn<(updated: UserDetail) => Promise<void>>();
  const view = render(
    <QueryClientProvider client={client}>
      <AvatarPicker profile={profile} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return {
    user: userEvent.setup(),
    onSaved,
    rerenderWith: (next: UserDetail) => {
      view.rerender(
        <QueryClientProvider client={client}>
          <AvatarPicker profile={next} onSaved={onSaved} />
        </QueryClientProvider>,
      );
    },
  };
}

/** The picker IS `input[type="file"]` — HTML-AAM gives it no role, so query by type. */
function picker(): HTMLInputElement {
  const node = document.querySelector('input[type="file"]');
  if (!(node instanceof HTMLInputElement)) throw new Error('The card rendered no file picker.');
  return node;
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /save photo/i });
}

/** The first non-empty live status inside the card — FormField renders errors there. */
async function inlineMessage(): Promise<HTMLElement> {
  return waitFor(() => {
    const nodes = Array.from(document.querySelectorAll('[role="status"], [role="alert"]'));
    const said = nodes.find((node) => (node.textContent ?? '').trim() !== '');
    if (!(said instanceof HTMLElement)) throw new Error('No inline message appeared.');
    return said;
  });
}

describe('AvatarPicker', () => {
  it('shows the current avatar from /me, generated fallback included', () => {
    const { rerenderWith } = renderPicker(PROFILE);

    /*
     * Radix keeps the image out of the accessibility tree until it paints, so the
     * element-level assertion is the honest one here: whatever face the server
     * serves — uploaded or DiceBear — is rendered as-is. There is no "no avatar"
     * branch for the picker to invent.
     */
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(DICEBEAR_URL);

    // The API can attach a new picture and nothing else, so no removal affordance.
    expect(screen.queryByRole('button', { name: /remove|delete|clear/i })).toBeNull();

    rerenderWith({ ...PROFILE, avatarUrl: SIGNED_AVATAR_URL });
    expect(document.querySelector('img')?.getAttribute('src')).toBe(SIGNED_AVATAR_URL);
  });

  it('refuses an oversized file inline, before any network call', async () => {
    const { user } = renderPicker();
    // A JPEG passes the chooser's accept filter, so the whole 3 MB reaches OUR
    // validation rather than being stopped by the browser.
    await user.upload(picker(), imageFile({ size: 3 * 1024 * 1024 }));

    const problem = await inlineMessage();
    expect(problem.textContent ?? '').toMatch(/largest accepted here is 2\.0 MB/i);

    // The rejected choice is cleared out of the control too, so re-picking the
    // same filename after fixing the file fires change again instead of
    // tripping a "nothing changed" short-circuit in the browser or the library.
    expect(picker().files?.length ?? 0).toBe(0);

    await waitFor(() => {
      expect(apiPost).not.toHaveBeenCalled();
      expect(apiPatch).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  it('refuses a non-image file inline, before any network call', async () => {
    renderPicker();

    /*
     * The browser's "All files" escape hatch, delivered by hand. `user.upload`
     * cannot play that role here: its own chooser filter runs against `accept`
     * with no way to turn it off from a call (its config-level `applyAccept` is
     * not an argument of `upload`, and a text/plain file fails an image-only
     * filter), so the helper would drop the file before firing any event and
     * the picker would never be asked. Setting `files` directly is exactly what
     * the escape hatch does — the real check under test is ours.
     */
    fireEvent.change(picker(), {
      target: { files: [imageFile({ type: 'text/plain' })] },
    });

    const problem = await inlineMessage();
    expect(problem.textContent ?? '').toMatch(/text\/plain files are not accepted here/i);

    await waitFor(() => {
      expect(apiPost).not.toHaveBeenCalled();
      expect(apiPatch).not.toHaveBeenCalled();
      expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
  });

  it('is busy across the whole save, then hands the updated record back', async () => {
    let resolvePresign!: (value: unknown) => void;
    const heldPresign = new Promise((resolve) => {
      resolvePresign = resolve;
    });
    apiPost.mockImplementationOnce(() => heldPresign);

    const { user, onSaved, rerenderWith } = renderPicker();
    await user.upload(picker(), imageFile());
    await user.click(saveButton());

    // Busy for the WHOLE path, not just one leg: the button stays announced-busy
    // until the PATCH resolves, and the live region names what is happening.
    const button = saveButton();
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('status').textContent).toMatch(/uploading/i);

    resolvePresign(PRESIGN);

    // The PUT rides the XHR transport now; the fake holds it open until completed.
    (await sentPut()).finish({ status: 200 });

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    expect(apiPatch).toHaveBeenCalledWith('/users/me', { avatarUploadId: UPLOAD_ID });
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));

    // The page owns the cache moves; the picker hands back the server's answer.
    expect(toastMock.success).toHaveBeenCalledWith('Profile photo updated');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(UPDATED_PROFILE));
    expect(screen.getByRole('status').textContent).not.toMatch(/uploading/i);

    rerenderWith(UPDATED_PROFILE);
    expect(document.querySelector('img')?.getAttribute('src')).toBe(SIGNED_AVATAR_URL);
  });

  it('toasts the upload failure’s own sentence, not the generic fallback', async () => {
    const { user } = renderPicker();
    await user.upload(picker(), imageFile());
    await user.click(saveButton());

    // A refused PUT: the store answered, `uploadFile` translated it into a sentence.
    (await sentPut()).finish({ status: 403 });

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const [title] = toastMock.mock.calls[0] as unknown[];
    expect(String(title)).toMatch(/upload link|refused|choose the file again/i);
    expect(toastMock.success).not.toHaveBeenCalled();
    // The ApiError path would have replaced the sentence with the generic fallback.
    expect(toastMock.fromError).not.toHaveBeenCalled();
  });

  it('routes everything that is not an upload failure through toast.fromError', async () => {
    const rejection = new ApiError({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'CONFLICT',
      requestId: 'req-1',
    });
    apiPost.mockImplementation((path) =>
      path.includes('/uploads/presign') ? Promise.reject(rejection) : Promise.resolve(COMMITTED),
    );

    const { user } = renderPicker();
    await user.upload(picker(), imageFile());
    await user.click(saveButton());

    await waitFor(() => expect(toastMock.fromError).toHaveBeenCalledTimes(1));
    const [error, fallback] = toastMock.fromError.mock.calls[0] as unknown[];
    expect(error).toBe(rejection);
    expect(fallback).toBe('Could not update your profile photo');
  });
});
