/**
 * The upload the SPA performs in three steps: presign with our API, PUT the bytes
 * straight to the object store, then commit.
 *
 * WHY the middle step is not `api.post`. The signed URL points at the object store,
 * which is a DIFFERENT ORIGIN from our API, and the api client sends
 * `credentials: 'include'` on every request it makes (api.ts:58) plus whatever CSRF
 * headers it grows. Routing the PUT through it would hand the `__Host-sw_session`
 * cookie to a host that has no business seeing it, and a bucket's access log is not
 * where a session cookie should end its life. So the PUT is a plain `fetch` that
 * sends exactly the headers the presign response named and nothing else.
 *
 * WHY commit exists at all. The API is never in the byte path, so its only evidence
 * about what was stored is a HeadObject — that is what `POST /uploads/commit` does
 * before it promotes the row out of PENDING (apps/api/src/modules/uploads/
 * uploads.service.ts, `commit`). An upload that is never committed is a PENDING row
 * that no resource can attach.
 */

import {
  UPLOAD_LIMITS,
  type PresignUploadResponse,
  type UploadDto,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { logger } from '@/lib/logger';
import type { UploadPurpose } from '@/lib/types';

/** What a caller needs about a committed upload in order to attach it to a row. */
/**
 * A failure the user can act on, raised only where the message has been written for
 * them — the object store's own 403 body is `SignatureDoesNotMatch` XML and belongs in
 * the log, not on screen.
 *
 * A distinct class rather than a bare `Error` because the caller has to be able to tell
 * "this message was composed for a human" from "something unexpected threw". Without
 * it, `toast.fromError` correctly refuses to show an arbitrary `Error.message` — it
 * could be a TypeError from a bug — and every message this module composes is replaced
 * by the caller's generic fallback, which is what was happening.
 */
/**
 * A tag, not a subclass.
 *
 * The dialog has to tell "this message was written for a human" from "something
 * unexpected threw": `toast.fromError` shows `ApiError.userMessage` and otherwise falls
 * back to the caller's generic copy, correctly refusing to put an arbitrary
 * `Error.message` on screen — it could be a TypeError from a bug. Without a way to opt
 * in, every sentence composed here was replaced by that fallback.
 *
 * A `class UploadFailure extends Error` would read better and buys nothing: subclassing
 * a built-in survives neither downlevelling nor every matcher, and a boolean answers
 * the only question the caller actually asks.
 */
export interface UploadFailure extends Error {
  readonly isUploadFailure: true;
}

function uploadFailure(message: string): UploadFailure {
  return Object.assign(new Error(message), { isUploadFailure: true as const });
}

/** True when the message was composed for a user and is safe to show verbatim. */
export function isUploadFailure(error: unknown): error is UploadFailure {
  return error instanceof Error && (error as Partial<UploadFailure>).isUploadFailure === true;
}

export interface UploadedFile {
  uploadId: string;
  sizeBytes: number;
  contentType: string;
  originalName: string;
}

/**
 * `presignUploadSchema` refuses `originalName` longer than 255 characters after a
 * trim (upload.ts:50). Mirrored here for the same reason the size and MIME limits
 * are: so an unusable filename is a message on the field rather than a 422 the user
 * has to decode after choosing the file.
 */
const MAX_ORIGINAL_NAME_LENGTH = 255;

/**
 * A user-facing reason the file is unacceptable, or null when it is fine.
 *
 * This is a CONVENIENCE, not the enforcement. `presignUploadSchema` applies the same
 * limits server-side (upload.ts:54-70), and since the signature now names
 * `content-length` the object store refuses an oversized body itself
 * (apps/api/src/lib/storage.ts, `presignPut`; LESSONS-LEARNED #32). The point of
 * running the check here is that the user learns a 600 MB file is too big BEFORE a
 * round trip that has to read it.
 *
 * The order of the tests is the order in which a problem is worth reporting: an
 * empty or unnameable file is a mis-selection, the type is the fact no amount of
 * re-exporting will change, and the size is the one the user can act on by
 * compressing.
 */
export function describeFileProblem(file: File, purpose: UploadPurpose): string | null {
  const limit = UPLOAD_LIMITS[purpose];

  // `sizeBytes: z.number().int().min(1)` (upload.ts:52) — a zero-byte file is a 422,
  // and it is almost always a file the browser could not read rather than one the
  // user meant to send.
  if (file.size === 0) {
    return 'That file is empty. Choose a file with something in it.';
  }

  if (file.name.trim().length === 0 || file.name.trim().length > MAX_ORIGINAL_NAME_LENGTH) {
    return `File names must be between 1 and ${MAX_ORIGINAL_NAME_LENGTH} characters. Rename the file and try again.`;
  }

  // The browser leaves `type` empty when it cannot map the extension. Presign would
  // reject the empty string too, so say what happened rather than sending nothing.
  if (file.type.length === 0) {
    return "The browser could not tell what kind of file that is. Check the file's extension, or try a different file.";
  }

  if (!limit.mimeTypes.includes(file.type)) {
    return `${file.type} files are not accepted here.`;
  }

  if (file.size > limit.maxBytes) {
    return `That file is ${formatBytes(file.size)}. The largest accepted here is ${formatBytes(limit.maxBytes)}.`;
  }

  return null;
}

/**
 * Why the store's own status codes are translated rather than surfaced.
 *
 * The body of a refusal is an S3-flavoured XML document naming things like
 * `SignatureDoesNotMatch`, which tells the user nothing and tells a support desk
 * only what the log already has. The status, though, does map to two situations the
 * user can genuinely act on, so those two get sentences and everything else gets an
 * honest generic.
 */
function describePutFailure(status: number): string {
  if (status === 403) {
    // Both the expiry and a body whose length differs from the signed
    // `content-length` land here (LESSONS-LEARNED #32).
    return 'The upload link was refused. It may have expired, or the file may have changed since you chose it. Choose the file again and retry.';
  }
  if (status === 413) {
    return 'The file store rejected that file as too large.';
  }
  return `The file store could not accept that file (error ${status}). Try again in a moment.`;
}

/**
 * presign -> PUT -> commit. Resolves with the committed upload.
 *
 * Rejects with an `Error` whose message is fit to toast at every step, and NEVER
 * commits an upload whose PUT did not succeed: a committed row asserts that the
 * bytes are in the bucket, and `commit`'s HeadObject would refuse it anyway.
 *
 * NO BYTE-LEVEL PROGRESS. `fetch` cannot report request-body progress — the streaming
 * `duplex` upload path is not implemented across the browsers this app supports, and
 * `XMLHttpRequest` is the only API that has `upload.onprogress`. Introducing XHR for
 * one dialog is not this change, and a bar that animates on a timer rather than on
 * bytes is a lie about a 512 MB upload. Callers show a busy state instead.
 *
 * The returned values come from the COMMITTED ROW, not from the `File`: `commit`
 * reads `sizeBytes` and `contentType` back off the stored object, so this is what the
 * server will tell every future reader the resource is.
 */
export async function uploadFile(file: File, purpose: UploadPurpose): Promise<UploadedFile> {
  // Re-checked here rather than trusted to the caller: `uploadFile` is reachable from
  // any form, and a file the limits already refuse should not cost a presign — which
  // writes a PENDING row that nothing currently sweeps.
  const problem = describeFileProblem(file, purpose);
  if (problem !== null) throw uploadFailure(problem);

  const presigned = await api.post<PresignUploadResponse>('/uploads/presign', {
    purpose,
    originalName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });

  let stored: Response;
  try {
    stored = await fetch(presigned.url, {
      method: presigned.method,
      // EXACTLY the headers the server signed, verbatim. `content-type` is inside the
      // signature, so adding to this set or dropping from it is a 403. `content-length`
      // is deliberately absent: it is a forbidden header for `fetch`, the runtime
      // computes it from the body, and that computed value is what the signature is
      // checked against — which is why a File whose size no longer matches what was
      // declared at presign is refused by the store rather than silently stored.
      headers: presigned.headers,
      body: file,
      // Explicit, though `same-origin` would already withhold them cross-origin:
      // the whole reason this call bypasses the api client is that no credential of
      // ours may reach the object store, and that intent should be readable here.
      credentials: 'omit',
    });
  } catch (cause) {
    // A DNS failure, an offline device, or a CORS rule on the bucket that does not
    // allow PUT from this origin. None of them reached the store.
    logger.error('Upload PUT could not be sent', { uploadId: presigned.uploadId, cause });
    throw uploadFailure(
      'The file could not be sent. Check your connection and try again — nothing was uploaded.',
    );
  }

  if (!stored.ok) {
    let detail = '';
    try {
      detail = await stored.text();
    } catch {
      detail = '';
    }
    // The store's XML goes to the log, where someone debugging can read the code in
    // it; the user gets a sentence. Deliberately no commit: the bytes are not there.
    logger.error('Upload PUT refused by the object store', {
      uploadId: presigned.uploadId,
      status: stored.status,
      detail,
    });
    throw uploadFailure(describePutFailure(stored.status));
  }

  const committed = await api.post<UploadDto>('/uploads/commit', {
    uploadId: presigned.uploadId,
  });

  return {
    uploadId: committed.id,
    sizeBytes: committed.sizeBytes,
    contentType: committed.contentType,
    originalName: committed.originalName,
  };
}
