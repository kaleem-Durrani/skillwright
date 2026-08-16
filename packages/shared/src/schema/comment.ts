import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

/**
 * One comment shape for resources and announcements, mirroring the single Comment
 * table. Two near-identical DTOs would drift the same way the two tables did.
 */
export const commentSchema = z.object({
  id: idSchema,
  content: z.string(),
  author: userSummarySchema,
  resourceId: idSchema.nullable(),
  announcementId: idSchema.nullable(),
  parentId: idSchema.nullable(),
  replyCount: z.number().int(),
  /** True when the requesting actor may edit or delete it; saves the SPA re-deriving policy. */
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  editedAt: nullableIsoDateTimeSchema,
});
export type CommentDto = z.infer<typeof commentSchema>;

/** Exactly one target, matching `num_nonnulls(resource_id, announcement_id) = 1`. */
export const createCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    resourceId: idSchema.optional(),
    announcementId: idSchema.optional(),
    parentId: idSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const targets = [body.resourceId, body.announcementId].filter((v) => v !== undefined);
    if (targets.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resourceId'],
        message: 'A comment attaches to exactly one resource or announcement.',
      });
    }
  });
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const listCommentsQuerySchema = paginationQuerySchema.extend({
  resourceId: idSchema.optional(),
  announcementId: idSchema.optional(),
  /** Omit for top-level comments; pass an id to page a single thread's replies. */
  parentId: idSchema.optional(),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
