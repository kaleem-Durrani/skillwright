import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authorize, requireActor } from '../../plugins/auth.plugin.js';
import {
  commitUploadSchema,
  presignUploadSchema,
  presignUploadResponseSchema,
  uploadSchema,
} from './uploads.schema.js';
import * as uploadService from './uploads.service.js';

/**
 * A `SubjectLoader` receives the BARE FastifyRequest (auth.plugin.ts:106-108), not the
 * type-provider-narrowed one, so `request.body` is `unknown` there — the same problem
 * `idOf` solves in resources.routes.ts:19-30.
 *
 * A narrowing guard rather than that file's `as` cast, because a cast here would be
 * asserting something the type system genuinely cannot see and this module has a safe
 * `undefined` to fall back on: an unreadable body yields no subject, `isSelf` denies, and
 * the caller gets a 403 instead of a `TypeError` inside a preHandler. Body validation
 * runs before `preHandler` in Fastify's lifecycle, so in practice the guard always
 * succeeds — it is the one path that would otherwise trust that ordering silently.
 */
function uploadIdOfBody(request: FastifyRequest): string | undefined {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || !('uploadId' in body)) return undefined;
  return typeof body.uploadId === 'string' ? body.uploadId : undefined;
}

const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /*
   * No subject loader, and that is not an oversight of the kind LESSONS-LEARNED #15
   * describes. `upload:presign` is `deny` for anonymous and a flat `allow` for all three
   * roles (`POLICY`), so every cell is a subject-free rule — which is why the
   * action is listed in SUBJECT_INDEPENDENT_ACTIONS and why an empty
   * subject here denies nobody who should be allowed. The gate is doing one job:
   * refusing logged-out callers a signature into a private bucket.
   *
   * There is nothing to load a subject FROM in any case. The row does not exist yet;
   * this endpoint is what creates it.
   *
   * `requireActor` is not a second auth check — `authorize()` has already thrown 401 for
   * a null actor (auth.plugin.ts:121) — it is how the handler obtains the typed `Actor`
   * that becomes `ownerId`. The body has no owner field to prefer over it
   * (upload.ts:46-53), deliberately.
   *
   * 201, because a row is created: the PENDING `Upload` is a real resource with an id the
   * client is about to commit, not merely a computed answer.
   */
  app.post(
    '/presign',
    {
      schema: { body: presignUploadSchema, response: { 201: presignUploadResponseSchema } },
      preHandler: authorize('upload:presign'),
    },
    async (request, reply) =>
      reply.status(201).send(await uploadService.presign(requireActor(request), request.body)),
  );

  /*
   * The subject is the Upload row named in the BODY, and every `upload:commit` cell is
   * `isSelf` including ADMIN's (`POLICY`). The `upload:commit` STUDENT cell writes the reason
   * into the table itself: "Committing someone else's pending upload would let an
   * attacker attach bytes they never uploaded."
   *
   * 200 rather than 201: the row already exists, this transitions it. The full
   * `uploadSchema` comes back rather than a 204 so the SPA can attach `sizeBytes` and
   * `contentType` to whatever it builds next without a second round trip.
   *
   * Both come from the bucket rather than from the request — but be precise about what
   * that buys. `sizeBytes` is a real measurement of what was stored. `contentType` is
   * the label the client chose at presign, pinned into the PUT signature so the store
   * accepts nothing else, and read back here; the BYTES are never sniffed. Someone who
   * declares `application/pdf` and uploads an executable gets a row saying
   * `application/pdf`. Which is why `presignGet` serves everything as an attachment.
   */
  app.post(
    '/commit',
    {
      schema: { body: commitUploadSchema, response: { 200: uploadSchema } },
      preHandler: authorize('upload:commit', (request) => {
        const uploadId = uploadIdOfBody(request);
        return uploadId === undefined ? undefined : uploadService.loadUploadSubject(uploadId);
      }),
    },
    async (request) => uploadService.commit(request.body.uploadId),
  );
};

export default uploadsRoutes;
