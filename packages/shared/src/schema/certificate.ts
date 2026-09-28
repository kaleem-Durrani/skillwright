import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema, slugSchema } from './common.js';
import { userSummarySchema } from './user.js';

/**
 * The catalogue of qualifications this school awards, and the certificates it issues
 * against it. Migration 0013 is where the argument for both tables lives; this file is
 * only the wire contract.
 *
 * THE REFERENCE IS THE WHOLE DESIGN. `referenceSchema` below is not a string that
 * happens to be unique — it is the only thing an employer can check, and
 * `GET /certificates/verify/:reference` is the one unauthenticated route in this
 * system. Everything about it is server-generated: 26 Crockford base32 characters over
 * 16 CSPRNG bytes, so a printed certificate cannot be forged by guessing and a typed
 * one cannot be mistyped into a valid-looking neighbour.
 */
export const referenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(26, 'A certificate reference is 26 characters long.')
  // Crockford base32 omits I, L, O and U — the four characters a person reading a
  // printout transcribes wrong. The LAST character is restricted to `0`-`7` because
  // 16 bytes is 128 bits and 26 base32 characters carry 130, so only the first eight
  // alphabet members can appear in the final position. The database's own CHECK
  // (migration 0013) holds the length floor; this holds the alphabet, which is the
  // half a length check cannot state.
  .regex(/^[0-9A-HJKMNP-TV-Z]{25}[0-7]$/, 'That does not look like a certificate reference.');
export type CertificateReference = z.infer<typeof referenceSchema>;

/** One entry in the catalogue. `code` is the standard's own number, not a display name. */
export const qualificationSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  level: z.string(),
  awardingBody: z.string(),
});
export type QualificationDto = z.infer<typeof qualificationSchema>;

/**
 * The catalogue as a BARE ARRAY, unpaginated and capped server-side.
 *
 * `GET /departments` is paginated and this is not, and the difference is the size of
 * the thing. A department list is a page of navigation; a school's award catalogue is
 * the six-to-sixty entries that fit in a phone's select with no scrolling interaction
 * at all, and paginating it would mean the issue dialog has to ask "is there a next
 * page" before it can offer a qualification — a second request and a second response
 * shape for a list nobody has ever paged through. The cap (not a `limit` parameter)
 * is the same one `GET /assignments/mine` uses, for the same reason: an unbounded
 * `findMany` on a table a school can write to is a shape nobody should ship on the
 * strength of "it will not happen".
 */
export const qualificationListSchema = z.array(qualificationSchema);
export type QualificationList = z.infer<typeof qualificationListSchema>;

/**
 * A stored certificate, as its holder and as the staff who issued it see it.
 *
 * `artifact` carries the UPLOAD's identity and display fields and never its key or
 * bucket: the bytes are reached through a short-lived signed URL from
 * `GET /certificates/:id/download`, exactly as a resource's are, and no DTO in this
 * system hands a client an object-store path.
 */
export const certificateSchema = z.object({
  id: idSchema,
  /** Echoed back to the holder. It is not a secret — it is the thing they read out. */
  reference: z.string(),
  issuedAt: isoDateTimeSchema,
  issuedBy: userSummarySchema.nullable(),
  qualification: qualificationSchema,
  /** The seat this came from. Null once the intake it was issued against is gone. */
  enrollmentId: idSchema.nullable(),
  revokedAt: nullableIsoDateTimeSchema,
  revokedBy: userSummarySchema.nullable(),
  /**
   * The grounds, and only ever to somebody entitled to see this row. The public verify
   * response below carries `revoked: true` and nothing more: a revocation is a public
   * fact, its reasons are not.
   */
  revokedReason: z.string().nullable(),
  artifact: z
    .object({
      id: idSchema,
      originalName: z.string(),
      contentType: z.string(),
      sizeBytes: z.number().int(),
    })
    .nullable(),
});
export type CertificateDto = z.infer<typeof certificateSchema>;

export const certificateListSchema = z.object({ data: z.array(certificateSchema) });
export type CertificateList = z.infer<typeof certificateListSchema>;

/**
 * What `GET /certificates/verify/:reference` answers, and the ONLY shape the
 * unauthenticated route is allowed to produce.
 *
 * FOUR FIELDS, and the omissions are the security design rather than a summary:
 *
 *   no `id`      a row id is an internal key, and one that a caller could then try
 *                 against an authenticated endpoint
 *   no `email`   the holder's address is the single most valuable field on this row
 *                 and nothing about a verification needs it
 *   no `studentId`  the same argument, and it is the one that would turn "does this
 *                 certificate exist" into "does this person exist"
 *   no `revokedReason` — the revocation is announced, its grounds are not
 *   no `enrollmentId`, no `issuedBy` — the course a person took and the colleague who
 *                 signed for it are both somebody else's business
 *
 * A certificate is worth issuing precisely because a stranger can check it, and a
 * stranger is exactly who must not learn anything else from doing so.
 */
export const verifyResultSchema = z.object({
  /** The holder's name as issued. Present even when revoked — that is the point. */
  name: z.string(),
  /** The qualification's name, which is what "is this the right certificate" means. */
  qualification: z.string(),
  issuedAt: isoDateTimeSchema,
  revoked: z.boolean(),
});
export type VerifyResult = z.infer<typeof verifyResultSchema>;

/**
 * Issuing. The ENROLMENT is named rather than the student, on the plan's own chain:
 *
 *     seat -> attend -> submit -> be assessed -> complete -> qualify -> verify
 *
 * and the row that proves each arrow is the one that gates the next. A body carrying
 * `studentId` instead would let a certificate be issued to somebody who never sat the
 * course, and the service could not tell — there would be nothing to check it against.
 * The service refuses an enrolment that is not COMPLETED, which is the whole point of
 * the chain this phase closes.
 */
export const issueCertificateSchema = z.object({
  enrollmentId: idSchema,
  qualificationId: idSchema,
});
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

/**
 * Revoking. A reason is COMPULSORY, and it is the only body this module accepts that
 * is not a pair of ids.
 *
 * Withdrawing a qualification is an act against a person who did nothing wrong, and
 * `revokedAt` plus `revokedById` say when and who and not why — which is the shape an
 * employer asks about most often and the one nobody can then answer. The reason is
 * stored and shown to the holder; it is deliberately absent from the public verify
 * response, which reports the fact and not the grounds.
 */
export const revokeCertificateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Say why it is being revoked — the holder will be shown this.')
    .max(1_000),
});
export type RevokeCertificateInput = z.infer<typeof revokeCertificateSchema>;

/**
 * Adding to the catalogue. Admin-only, and it is the only reason
 * `qualification:create` exists as an action at all — see the note in policy.ts.
 */
export const createQualificationSchema = z.object({
  /**
   * Slug-shaped and NOT free text. `code` is what an employer types into a verifier,
   * so it is the one catalogue field with a syntactic contract: no spaces (a school
   * writes "C&G-L3-DIP" and a person types `CG-L3-DIP`), and lowercase, because it
   * shares `slugSchema` with course codes for the same reason.
   */
  code: slugSchema.max(40),
  name: z.string().trim().min(2).max(160),
  level: z.string().trim().min(1).max(60),
  awardingBody: z.string().trim().min(2).max(160),
});
export type CreateQualificationInput = z.infer<typeof createQualificationSchema>;
