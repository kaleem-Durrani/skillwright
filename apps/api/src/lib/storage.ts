import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import type { UploadPurpose } from '@skillwright/shared';
import { env } from '../env.js';

/**
 * The one place in the API that talks to the object store.
 *
 * The API never proxies bytes: the browser PUTs straight to MinIO/S3 with a signed URL
 * and GETs the same way (upload.ts:73-76). So this module signs URLs, asks the store
 * one question — HeadObject — and deletes objects exactly once, from the sweeper; no
 * request path ever streams a file through Node.
 *
 * Like the mailer (mailer.ts:38-51) the client is built lazily rather than at import,
 * so importing this module in a unit test does not construct a socket pool for a bucket
 * that test will never touch.
 */

/** Every object this API writes lives in one bucket; `Upload.bucket` records it per row. */
export const BUCKET: string = env.S3_BUCKET;

/*
 * The two lifetimes differ because the two URLs are handed to different things.
 *
 * A PUT URL is given to a HUMAN who has yet to pick a file: the SPA asks for the
 * signature when the upload dialog opens, and the person then browses their disk,
 * changes their mind, and finally picks a 400 MB video that itself takes minutes to
 * send. Fifteen minutes covers that whole span, and the URL is single-purpose — it can
 * only write one server-chosen key with one declared content type.
 *
 * A GET URL is handed to a CLICK. It is minted by `GET /resources/:id/download` and
 * used by the browser immediately. Its blast radius is worse than the PUT's, because it
 * reads a private object and can be forwarded to anyone, so it lives exactly as long as
 * one navigation needs and no longer. That short window is the only thing standing
 * between "authorised download" and "public link", since the bucket itself is private
 * (`mc anonymous set none`) and has no other door.
 */
const PUT_URL_TTL_SECONDS = 15 * 60;
const GET_URL_TTL_SECONDS = 5 * 60;

/**
 * The folder each purpose writes into. These match the prefixes the seed already wrote
 * (seed.ts:606 `syllabi/…`, seed.ts:752 `resources/…`), so a bucket holding seeded rows
 * and live uploads has one layout rather than two.
 *
 * The prefix is the only record of an upload's purpose: `Upload` has no `purpose` column
 * (schema.prisma:392-419), which is deliberate — the purpose is spent at presign time,
 * where it selects the size and MIME limits (upload.ts:35-44). EXPORTED for the same
 * reason it exists: the avatar attachment point (`users.service.ts`) must confirm a
 * claimed upload was minted as an AVATAR, and the key prefix is the only evidence there
 * is or ever will be.
 */
export const PURPOSE_FOLDER: Readonly<Record<UploadPurpose, string>> = Object.freeze({
  AVATAR: 'avatars',
  RESOURCE: 'resources',
  SYLLABUS: 'syllabi',
});

/**
 * At most ONE dot-suffix of ASCII alphanumerics, lowercased, or nothing at all.
 *
 * The extension is the single fragment of the client's filename that reaches the key,
 * and it is rebuilt rather than copied. Everything that makes a filename dangerous in a
 * path lives outside `[a-z0-9]`: `../`, a NUL, a second extension in `invoice.pdf.exe`,
 * a query string, a leading dot. `lastIndexOf` takes the LAST suffix, so
 * `notes.tar.gz` becomes `.gz` and never `.tar.gz`.
 *
 * `dot <= 0` rather than `dot < 0`: a dotfile like `.bashrc` has its dot at index 0 and
 * is a name, not an extension.
 *
 * The 16-character cap is arbitrary but bounded on purpose — no real media extension
 * comes close (`.markdown` is the longest this API accepts, upload.ts:25), and a key is
 * a database column and an S3 path before it is anything else.
 */
function extensionOf(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  if (dot <= 0 || dot === originalName.length - 1) return '';
  const suffix = originalName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(suffix) ? `.${suffix}` : '';
}

/**
 * The object key, chosen by the SERVER on every single upload.
 *
 * upload.ts:49-50 and schema.prisma:394-395 both say it: the client's filename is
 * display text and never the key. If the caller picked the key they would pick
 * `avatars/../resources/<someone-else's-file>.pdf` on the first afternoon, and a
 * presigned PUT would then overwrite an object its owner never consented to lose.
 *
 * A ULID rather than a UUID because the rest of this repository already uses one
 * (app.ts:72 `genReqId`), and because it sorts by creation time — a bucket listing is
 * chronological for free, which matters to the sweeper described in
 * uploads.service.ts.
 *
 * The name the user typed survives as `Upload.originalName` and is what
 * `presignGet` puts in the Content-Disposition, so nothing about the download
 * experience is lost by making the key opaque.
 */
export function buildObjectKey(purpose: UploadPurpose, originalName: string): string {
  return `${PURPOSE_FOLDER[purpose]}/${ulid()}${extensionOf(originalName)}`;
}

/*
 * The shadow key a presigned PUT writes to, and the reason it exists: immutability of
 * committed objects (Phase 5, closing NEXT.md's "presigned PUTs outlive commit").
 *
 * SigV4 carries no nonce and a PUT URL lives fifteen minutes, so when the bytes went
 * straight to the object's final key, a caller could commit — have the bytes verified
 * and the resource published — and then re-PUT different same-length bytes over the
 * verified object before the signature expired. The upload test suite reproduces that
 * replacement verbatim. The layout answer is to give the URL a target whose
 * replacement costs nothing: the browser PUTs to `_pending/<final-key>`, `commit`
 * verifies there, SERVER-SIDE-COPIES to the final key, and only then promotes the row.
 * A replayed PUT can at worst re-create a file under `_pending/`, where no reader ever
 * looks; the object every download, avatar and syllabus serves was copied after
 * verification and has no valid write URL at all.
 *
 * The mapping is total in both directions on purpose. `presign` stores the FINAL key
 * on the row (so the wire shape, the purpose-prefix evidence assertUploadClaimable
 * reads, and every existing reader stay exactly as they were), and derives the shadow
 * with `stagingKeyFor` at the two moments that need it — signing the PUT, and commit's
 * HeadObject/copy/delete of the staged bytes. The sweeper uses the same function on
 * PENDING rows for the identical reason. `_committedFromStaging` is its inverse,
 * kept beside it so neither spelling of the convention can drift.
 */
export const STAGING_PREFIX = '_pending/';

/** Where a presigned PUT writes: the shadow of the object's final home. */
export function stagingKeyFor(committedKey: string): string {
  return `${STAGING_PREFIX}${committedKey}`;
}

/** Inverse of `stagingKeyFor`; identity for keys that were never staged. */
export function committedFromStaging(stagingKey: string): string {
  return stagingKey.startsWith(STAGING_PREFIX)
    ? stagingKey.slice(STAGING_PREFIX.length)
    : stagingKey;
}

let client: S3Client | null = null;

function getClient(): S3Client {
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    // MinIO serves `http://host:9002/<bucket>/<key>`; virtual-host style would resolve
    // `skillwright-uploads.localhost` and fail before a request left the process.
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/**
 * A signed PUT for one key and one content type.
 *
 * `signableHeaders` is not optional decoration. Query signing puts only `host` in
 * `X-Amz-SignedHeaders` by default — anything set on the command is then a suggestion
 * the store never checks. BOTH limits are named here, and both were measured against
 * the MinIO in `docker-compose.yml` rather than assumed:
 *
 *   signed headers                        body sent      MinIO answers
 *   content-type;host                     500B vs 23B    200, stored
 *   content-length;content-type;host      23B vs 23B     200, stored
 *   content-length;content-type;host      500B vs 23B    403 SignatureDoesNotMatch
 *
 * So without `content-length` in the signature, `UPLOAD_LIMITS[purpose].maxBytes` was
 * enforced only by the zod check in front of it: an authenticated caller could declare
 * a 1 KB avatar, receive the signature, and PUT half a gigabyte at that key. `commit`
 * would refuse the row afterwards, but the BYTES were already in a bucket nothing
 * reclaims until the sweeper collects them (uploads.sweeper.ts).
 *
 * With both named, the store refuses the request itself. That is the "enforced twice …
 * refused by the object store itself" that upload.ts:31-33 promises, now true of the
 * size as well as the type.
 *
 * `content-length` is deliberately NOT in the returned `headers`. It is a forbidden
 * header name for `fetch` and XHR — the runtime computes it from the body, which is
 * exactly the value the signature has to match, so a client that sends a different file
 * than the one it declared is refused without the client having to cooperate. A body
 * streamed with chunked encoding sends no `Content-Length` at all and is refused too,
 * which is correct: an unmeasured upload is the case this is here to stop.
 *
 * `content-type` IS returned, because the browser will not otherwise send the exact
 * string that was signed.
 *
 * Nothing is contacted here: SigV4 query signing is pure arithmetic over the request
 * and the secret, so this is `async` only because `getSignedUrl` is.
 */
export async function presignPut(input: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }> {
  const url = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    }),
    {
      expiresIn: PUT_URL_TTL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  );

  return {
    url,
    headers: { 'content-type': input.contentType },
    expiresAt: new Date(Date.now() + PUT_URL_TTL_SECONDS * 1000),
  };
}

/**
 * A user-supplied filename, reduced to something safe to put in a header AND safe to
 * hand to a client that will render it.
 *
 * Exported because two callers need the identical answer and used to disagree:
 * `attachmentDisposition` below cleaned the name, while `buildDownloadUrl` in the
 * resources service returned `Upload.originalName` RAW in the JSON body. The header
 * was safe and the payload was not — and the payload is the half a future client is
 * most likely to render. Nothing renders it today, which made it a trap rather than a
 * live bug; the fix is three lines and removes the trap.
 *
 * Removed: C0 and C1 controls, which include the CR/LF that would split a header
 * outright; the bidi overrides and isolates, because `invoice<U+202E>fdp.exe` displays
 * as `invoice.pdf` in every file dialog that honours them; and both path separators, so
 * the value can never read as a path. Empty after all that becomes `download`.
 *
 * Percent-encoding is NOT sanitisation — the browser decodes it straight back — which
 * is why this runs before the encoding rather than instead of it.
 */
export function safeFilename(filename: string): string {
  const clean = filename
    // eslint-disable-next-line no-control-regex -- C0/C1 is precisely what must go.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[/\\]/g, '_')
    .trim();
  return clean.length > 0 ? clean : 'download';
}

/**
 * `Content-Disposition: attachment` for a filename that came from a user.
 *
 * Two forms, per RFC 6266: a quoted ASCII fallback for anything old, and `filename*`
 * carrying the real UTF-8 name for everything current. The quoted form is stripped down
 * to printable ASCII precisely because the value is user-supplied — a quote or a
 * backslash would close the quoted-string early and a CR/LF would split the header, and
 * this string is signed into a URL that the object store replays into a response header
 * verbatim.
 *
 * `encodeURIComponent` leaves `'()*` alone, and none of them are `attr-char`
 * (RFC 5987 §3.2.1), so they are percent-escaped by hand afterwards.
 */
function attachmentDisposition(filename: string): string {
  /*
   * Clean ONCE, then derive both forms from the result.
   *
   * The quoted fallback used to be the only sanitised half while `filename*` was built
   * from the raw name — which is backwards, because `filename*` is the form every
   * current browser PREFERS. Percent-encoding is not sanitisation: it makes a byte safe
   * to carry in a header, and the browser decodes it straight back. So a name holding
   * U+202E (right-to-left override) reached the download dialog intact, where
   * `invoice<RLO>fdp.exe` displays as `invoice.pdf`; and a name holding a path
   * separator arrived as a path rather than a filename.
   *
   * Stripped here: C0 and C1 controls (which include the CR/LF that would split the
   * header outright), the bidi overrides and isolates, and both path separators.
   */
  const safe = safeFilename(filename);

  // The quoted form is additionally flattened to printable ASCII: a quote or a
  // backslash would close the quoted-string early, and anything non-ASCII is exactly
  // what `filename*` exists to carry.
  const ascii = safe
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim();
  const fallback = ascii.length > 0 ? ascii : 'download';

  // `encodeURIComponent` leaves `'()*`, which are not `attr-char` in RFC 5987.
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * A short-lived signed GET that makes the browser SAVE the object rather than render it.
 *
 * `ResponseContentDisposition` is the reason this is not just a URL: without it a PDF
 * opens in the tab under a MinIO hostname and an `01J….html` resource would render as a
 * document served from our own storage origin. `attachment` also means the object store
 * hands the file back under the name the user originally chose, which is the only place
 * `Upload.originalName` is ever used for anything but display.
 */
export async function presignGet(input: {
  key: string;
  filename: string;
}): Promise<{ url: string; expiresAt: Date }> {
  const url = await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: input.key,
      ResponseContentDisposition: attachmentDisposition(input.filename),
    }),
    { expiresIn: GET_URL_TTL_SECONDS },
  );

  return { url, expiresAt: new Date(Date.now() + GET_URL_TTL_SECONDS * 1000) };
}

/**
 * A missing object, told apart from a broken bucket.
 *
 * The distinction is load-bearing: `commit` answers 422 "the bytes never arrived" for a
 * missing object and must NOT answer that when MinIO is down, out of credentials or
 * misconfigured — those are 500s, and swallowing them would let a user retry a commit
 * forever against a store that is simply unreachable.
 *
 * HeadObject has no response body at all, so the SDK models its 404 as `NotFound`
 * rather than the `NoSuchKey` that GetObject returns; the raw status is checked as well
 * so a 404 the SDK failed to name is still a missing object.
 */
function isMissingObject(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.$metadata.httpStatusCode === 404
  );
}

/**
 * What the object store actually holds at `key`, or `null` if it holds nothing.
 *
 * This is the checkpoint the whole commit step exists for. The client declares a size
 * and a MIME type at presign; the browser then PUTs directly to the bucket with the API
 * nowhere in the path, so the ONLY evidence the API ever has that the declaration was
 * honest is this call.
 *
 * `null` rather than a throw for a missing object, because "nothing was uploaded" is an
 * ordinary outcome — a user who opened the dialog and closed it, or a PUT that failed —
 * and it becomes a 422 at a field path rather than a stack trace (uploads.service.ts).
 *
 * The defaults exist so the return type has no optional fields to unwrap: an object
 * whose `Content-Type` the store did not record is reported as `application/octet-stream`,
 * which disagrees with anything a caller could legally have declared and is therefore
 * refused at commit rather than silently accepted.
 */
export async function headObject(
  key: string,
): Promise<{ contentType: string; sizeBytes: number } | null> {
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      contentType: head.ContentType ?? 'application/octet-stream',
      sizeBytes: head.ContentLength ?? 0,
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

/**
 * A server-side copy inside the bucket: the step that makes a committed object
 * immutable.
 *
 * `commit` has just verified the staged bytes against their declaration; copying them
 * to the final key — with the store doing the work, no bytes through this process, the
 * same rule as every other path here — is what puts verification and residence on the
 * same side of every later PUT. The CopySource is URL-encoded per the S3 contract;
 * `encodeURIComponent` leaves `/` alone, so the bucket/key path shape survives.
 */
export async function copyObject(input: { fromKey: string; toKey: string }): Promise<void> {
  await getClient().send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      // `/bucket/key`, encoded: keys here are ULIDs and safe suffixes, but encoding is
      // the contract and costs nothing.
      CopySource: `/${BUCKET}/${encodeURIComponent(input.fromKey)}`,
      Key: input.toKey,
    }),
  );
}

/**
 * The first delete this API has ever issued against the bucket, and the sweeper's
 * entire object-store surface (uploads.sweeper.ts).
 *
 * DeleteObject is IDEMPOTENT by S3 semantics: deleting a key that holds no object
 * succeeds with 204, exactly like `headObject` answering null above. That is why there
 * is no existence check and no missing-object branch here — a PENDING row whose PUT
 * never happened (the common abandoned case) and one whose object was already deleted
 * by a previous sweep that died before it could delete the row are both swept in one
 * call. The ordering in the caller is what matters: OBJECT first, ROW second, so a
 * crash between the two leaves a row pointing at nothing rather than bytes pointing at
 * nothing — a retryable bookkeeping artefact, not an unreclaimable leak.
 *
 * Not exposed to any request path on purpose: every attachment point is `@unique` and
 * `onDelete`-guarded (Resource restricts, User.avatarUpload SetNull), so rows that mean
 * something are unreachable from here.
 */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
