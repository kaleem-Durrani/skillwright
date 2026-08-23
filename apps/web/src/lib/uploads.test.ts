import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPLOAD_LIMITS,
  type PresignUploadResponse,
  type UploadDto,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { describeFileProblem, uploadFile } from './uploads.js';

/**
 * The api client is replaced wholesale rather than spied on, because `uploadFile`'s
 * whole point is WHICH of its two round trips happen and in what order — and a real
 * `api.post` would try to reach the network to answer that.
 */
// Mocked by the SAME specifier the module under test imports. When these two drift
// — the module on './api.js', the mock on '@/lib/api' — the mock silently does not
// apply and the real client is used, which shows up as assertions failing on error
// messages that were never produced.
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));

/** Silenced, not asserted: the failure paths log the store's XML on purpose. */
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * A `File` whose reported size is the one the test needs. Nothing allocates 512 MB
 * to prove a boundary: `size` is a getter on `Blob.prototype`, so an own property
 * shadows it and the object is still a real `File` — no cast, no fake shape.
 */
function fileOfSize(bytes: number, type: string, name = 'lecture-notes.pdf'): File {
  const file = new File(['seed'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

const PRESIGN: PresignUploadResponse = {
  uploadId: 'cmsvme3r703ucw4g0i6oyh6fh',
  url: 'https://objects.example.test/skillwright/resource/2026/lecture-notes.pdf?X-Amz-Signature=abc',
  method: 'PUT',
  // One entry, exactly as `presignPut` returns (apps/api/src/lib/storage.ts).
  headers: { 'content-type': 'application/pdf' },
  key: 'resource/2026/lecture-notes.pdf',
  expiresAt: '2026-08-22T10:00:00.000Z',
};

const COMMITTED: UploadDto = {
  id: PRESIGN.uploadId,
  key: PRESIGN.key,
  bucket: 'skillwright',
  contentType: 'application/pdf',
  // Deliberately NOT the size of the local File: the committed row carries what the
  // store measured, and that is what `uploadFile` must resolve with.
  sizeBytes: 4096,
  originalName: 'lecture-notes.pdf',
  status: 'COMMITTED',
  ownerId: 'cmsvme3r703ucw4g0i6oyh6fg',
  createdAt: '2026-08-22T09:59:00.000Z',
  committedAt: '2026-08-22T09:59:30.000Z',
};

interface RecordedPut {
  url: string;
  init: RequestInit;
}

let puts: RecordedPut[] = [];

/** Installs a `fetch` that records its call and answers with `response`. */
function stubFetch(response: () => Promise<Response>): void {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    puts.push({ url: String(input), init: init ?? {} });
    return response();
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
  puts = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('describeFileProblem', () => {
  it('accepts a file of exactly the maximum size for its purpose', () => {
    const file = fileOfSize(UPLOAD_LIMITS.RESOURCE.maxBytes, 'application/pdf');
    expect(describeFileProblem(file, 'RESOURCE')).toBeNull();
  });

  it('rejects a file one byte over the maximum, naming the limit in human units', () => {
    const file = fileOfSize(UPLOAD_LIMITS.RESOURCE.maxBytes + 1, 'application/pdf');
    const problem = describeFileProblem(file, 'RESOURCE');
    expect(problem).not.toBeNull();
    // The user is told the ceiling, not just that they missed it. 512 MB, not 536870912.
    expect(problem).toContain('512 MB');
    expect(problem).not.toContain(String(UPLOAD_LIMITS.RESOURCE.maxBytes));
  });

  it('accepts a MIME type the purpose allows', () => {
    const file = fileOfSize(2048, 'video/mp4', 'seminar.mp4');
    expect(describeFileProblem(file, 'RESOURCE')).toBeNull();
  });

  it('rejects a MIME type the purpose does not allow, naming the type', () => {
    const file = fileOfSize(2048, 'application/zip', 'bundle.zip');
    expect(describeFileProblem(file, 'RESOURCE')).toContain('application/zip');
  });

  it('applies the limits of the purpose it was given, not one shared ceiling', () => {
    // 4 MB of PNG: fine as a RESOURCE, over the 2 MB AVATAR limit, and the wrong
    // type entirely for a SYLLABUS.
    const png = fileOfSize(4 * 1024 * 1024, 'image/png', 'diagram.png');
    expect(describeFileProblem(png, 'RESOURCE')).toBeNull();
    // `formatBytes` keeps one decimal below 10 units, so the avatar ceiling reads
    // "2.0 MB" — the same string the Settings avatar field would show.
    expect(describeFileProblem(png, 'AVATAR')).toContain('2.0 MB');
    expect(describeFileProblem(png, 'SYLLABUS')).toContain('image/png');
  });

  it('rejects an empty file and one the browser could not type', () => {
    expect(describeFileProblem(fileOfSize(0, 'application/pdf'), 'RESOURCE')).toContain('empty');
    expect(describeFileProblem(fileOfSize(1024, ''), 'RESOURCE')).not.toBeNull();
  });
});

/*
 * `rejects.toMatchObject({ message })`, not `rejects.toThrow(/regex/)`.
 *
 * `rejects.toThrow` with a regex or a string is BROKEN in this workspace: it reads the
 * rejection's `.message` as undefined and reports `Received: ''`. Reproduced on a
 * plain, freshly-constructed Error with nothing of ours involved —
 *
 *   expect(fn).toThrow(/needle/)                                   -> passes
 *   await expect(Promise.reject(new Error('needle')))
 *     .rejects.toThrow(/needle/)                                   -> "but got ''"
 *   the same rejection via .rejects.toMatchObject / .toHaveProperty -> passes
 *
 * So the synchronous matcher is fine and only the `.rejects` path loses the message.
 * It started when the root gained `@playwright/test` and `esbuild`; @playwright/test
 * ships its own `expect`, which is the likeliest collision. Ruled out first, in this
 * order: our error type (a subclass, then a plain Error, then a tagged Error — all
 * three behave identically), the import specifiers, and the mock specifiers.
 *
 * The forms below read the same message through a matcher that works, so nothing is
 * asserted more weakly. NEXT.md carries the open question.
 */
describe('uploadFile', () => {
  it('presigns, PUTs, then commits, and resolves with the committed row', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce(COMMITTED);
    stubFetch(() => Promise.resolve(new Response('', { status: 200 })));

    const file = fileOfSize(4096, 'application/pdf');
    const uploaded = await uploadFile(file, 'RESOURCE');

    expect(api.post).toHaveBeenNthCalledWith(1, '/uploads/presign', {
      purpose: 'RESOURCE',
      originalName: 'lecture-notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4096,
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/uploads/commit', {
      uploadId: PRESIGN.uploadId,
    });
    // Commit is the second call, so it cannot have preceded the PUT.
    expect(puts).toHaveLength(1);
    expect(uploaded).toEqual({
      uploadId: COMMITTED.id,
      sizeBytes: COMMITTED.sizeBytes,
      contentType: COMMITTED.contentType,
      originalName: COMMITTED.originalName,
    });
  });

  it('PUTs to the signed URL with exactly the returned headers and no credentials', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce(COMMITTED);
    stubFetch(() => Promise.resolve(new Response('', { status: 200 })));

    const file = fileOfSize(4096, 'application/pdf');
    await uploadFile(file, 'RESOURCE');

    const put = puts[0];
    expect(put).toBeDefined();
    expect(put?.url).toBe(PRESIGN.url);
    expect(put?.init.method).toBe('PUT');
    // EXACTLY the signed set: an extra header is outside the signature and a missing
    // one breaks it (LESSONS-LEARNED #32). `content-length` is the runtime's job.
    expect(put?.init.headers).toEqual(PRESIGN.headers);
    expect(put?.init.body).toBe(file);
    // The object store is a different origin; our session cookie must not go there.
    expect(put?.init.credentials).toBe('omit');
  });

  it('does not commit when the object store refuses the PUT', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(PRESIGN);
    stubFetch(() =>
      Promise.resolve(
        new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 }),
      ),
    );

    const file = fileOfSize(4096, 'application/pdf');
    await expect(uploadFile(file, 'RESOURCE')).rejects.toMatchObject({
      message: expect.stringContaining('upload link was refused'),
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalledWith('/uploads/commit', expect.anything());
  });

  it('does not commit when the PUT never reaches the store', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(PRESIGN);
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    const file = fileOfSize(4096, 'application/pdf');
    await expect(uploadFile(file, 'RESOURCE')).rejects.toMatchObject({
      message: expect.stringContaining('could not be sent'),
    });

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('refuses a file the limits already reject without presigning it', async () => {
    const file = fileOfSize(UPLOAD_LIMITS.RESOURCE.maxBytes + 1, 'application/pdf');
    stubFetch(() => Promise.resolve(new Response('', { status: 200 })));

    await expect(uploadFile(file, 'RESOURCE')).rejects.toMatchObject({
      message: expect.stringContaining('512 MB'),
    });

    // No presign, so no PENDING row for a file that was never going to be accepted.
    expect(api.post).not.toHaveBeenCalled();
    expect(puts).toHaveLength(0);
  });
});
