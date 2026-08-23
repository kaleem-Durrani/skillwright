/**
 * The uploads module binds request and response shapes from @skillwright/shared rather
 * than declaring its own, for the same reason resources.schema.ts does (resources.schema.ts:1-11):
 * a second definition of what an upload looks like would drift from the SPA's within a
 * sprint, and the drift would only surface at runtime.
 *
 * `presignUploadSchema` in particular is not a shape this module could honestly restate.
 * It carries the per-purpose size and MIME refinements (upload.ts:54-70) that read
 * `UPLOAD_LIMITS`, and those limits are the same table the SPA disables its file picker
 * against — so a 2 MB avatar cap that exists here and not there is a 422 the user meets
 * only after choosing a file.
 *
 * `downloadUrlResponseSchema` is deliberately NOT re-exported here even though it lives
 * in schema/upload.ts. The one route that returns it is `GET /resources/:id/download`
 * (resources.routes.ts:117-126), which belongs to the resources module; naming it in
 * this barrel would suggest this module serves it.
 */
export {
  commitUploadSchema,
  presignUploadSchema,
  presignUploadResponseSchema,
  uploadSchema,
  uploadPurposeSchema,
  uploadStatusSchema,
} from '@skillwright/shared';

export type {
  CommitUploadInput,
  PresignUploadInput,
  PresignUploadResponse,
  UploadDto,
  UploadPurpose,
  UploadStatusValue,
} from '@skillwright/shared';
