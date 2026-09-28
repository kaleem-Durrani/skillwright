/**
 * Route-level shapes for the certificates module, bound from `@skillwright/shared`
 * rather than re-declared — the same rule `assignments.schema.ts` states, for the same
 * reason: a second definition of a wire shape drifts from the SPA's within a sprint.
 *
 * The only LOCAL declaration is `referenceParamSchema`, and it is not local by choice:
 * it is `referenceSchema` from the shared package, narrowed to the one key the path
 * carries, so the alphabet and the length rule exist in exactly one place. A verifier
 * URL is built from those same rules in a browser and in a test.
 */
import { z } from 'zod';
import { referenceSchema } from '@skillwright/shared';

export const referenceParamSchema = z.object({ reference: referenceSchema });
export type ReferenceParam = z.infer<typeof referenceParamSchema>;

/**
 * `GET /certificates?studentId=` — the filter is `.nullish()` rather than required
 * because the SPA's call passes nothing and self-scopes (the `GET /enrollments`
 * pattern), while a teacher's reader names the student.
 *
 * A STUDENT who names somebody else gets their OWN rows back rather than a 403, and
 * that is deliberate: the row filter below is the authorization, and a filter that
 * cannot match anything is a more honest answer than a refusal that tells a student
 * another student's record exists.
 */
export const listCertificatesQuerySchema = z.object({
  studentId: z.string().nullish(),
});
export type ListCertificatesQuery = z.infer<typeof listCertificatesQuerySchema>;

export {
  certificateListSchema,
  certificateSchema,
  createQualificationSchema,
  downloadUrlResponseSchema,
  idParamSchema,
  issueCertificateSchema,
  qualificationListSchema,
  qualificationSchema,
  revokeCertificateSchema,
  verifyResultSchema,
} from '@skillwright/shared';

export type {
  CertificateDto,
  CertificateList,
  CertificateReference,
  CreateQualificationInput,
  DownloadUrlResponse,
  IssueCertificateInput,
  QualificationDto,
  QualificationList,
  RevokeCertificateInput,
  VerifyResult,
} from '@skillwright/shared';
