import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

/**
 * Set by the creator, never inferred from a MIME type. ASSIGNMENT and QUIZ are
 * absent on purpose: the assessment engine is out of scope, and a reserved enum
 * value invites someone to half-build it.
 */
export const resourceTypeSchema = z.enum(['DOCUMENT', 'VIDEO', 'LINK']);
export type ResourceTypeValue = z.infer<typeof resourceTypeSchema>;

export const resourceSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string().nullable(),
  type: resourceTypeSchema,
  courseId: idSchema,
  courseName: z.string(),
  author: userSummarySchema,
  isPublic: z.boolean(),
  /** Present only for uploaded resources; LINK resources carry `externalUrl`. */
  uploadId: idSchema.nullable(),
  externalUrl: z.string().url().nullable(),
  sizeBytes: z.number().int().nullable(),
  contentType: z.string().nullable(),
  commentCount: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ResourceDto = z.infer<typeof resourceSchema>;

/**
 * Exactly one of `uploadId` / `externalUrl`, matching the CHECK constraint in
 * migration 0002. Validating it here means the DB constraint is a backstop rather
 * than the error message the user reads.
 */
const exactlyOneSource = (
  body: {
    uploadId?: string | null | undefined;
    externalUrl?: string | null | undefined;
    type?: ResourceTypeValue | undefined;
  },
  ctx: z.RefinementCtx,
): void => {
  const hasUpload = body.uploadId !== undefined && body.uploadId !== null;
  const hasUrl = body.externalUrl !== undefined && body.externalUrl !== null;
  if (hasUpload === hasUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['uploadId'],
      message: 'Provide either an uploaded file or an external URL, not both.',
    });
  }
  if (body.type === 'LINK' && hasUpload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'A LINK resource cannot carry an upload.',
    });
  }
};

export const createResourceSchema = z
  .object({
    courseId: idSchema,
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).optional(),
    type: resourceTypeSchema,
    uploadId: idSchema.nullish(),
    externalUrl: z.string().url().max(2048).nullish(),
    isPublic: z.boolean().default(false),
  })
  .superRefine(exactlyOneSource);
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).nullable(),
    type: resourceTypeSchema,
    isPublic: z.boolean(),
    externalUrl: z.string().url().max(2048).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const listResourcesQuerySchema = paginationQuerySchema.extend({
  courseId: idSchema.optional(),
  type: resourceTypeSchema.optional(),
  isPublic: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;
