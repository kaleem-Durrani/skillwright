import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema, slugSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

export const announcementTypeSchema = z.enum(['NEWS', 'EVENT', 'ANNOUNCEMENT']);
export type AnnouncementTypeValue = z.infer<typeof announcementTypeSchema>;

export const announcementSummarySchema = z.object({
  id: idSchema,
  title: z.string(),
  slug: slugSchema,
  type: announcementTypeSchema,
  /** First ~200 characters, built server-side so list pages never ship full bodies. */
  excerpt: z.string(),
  author: userSummarySchema,
  eventDate: nullableIsoDateTimeSchema,
  publishedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type AnnouncementSummary = z.infer<typeof announcementSummarySchema>;

export const announcementDetailSchema = announcementSummarySchema.extend({
  content: z.string(),
  commentCount: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export type AnnouncementDetail = z.infer<typeof announcementDetailSchema>;

/** An EVENT without a date is a NEWS post wearing a badge; reject it at the edge. */
const eventNeedsDate = (
  body: { type?: AnnouncementTypeValue | undefined; eventDate?: string | null | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (body.type === 'EVENT' && (body.eventDate === undefined || body.eventDate === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['eventDate'],
      message: 'An event needs a date.',
    });
  }
};

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    slug: slugSchema.optional(),
    content: z.string().trim().min(1).max(50_000),
    type: announcementTypeSchema,
    eventDate: z.string().datetime({ offset: true }).nullish(),
    /** Create-then-publish is two steps by default, so drafts are the safe path. */
    publish: z.boolean().default(false),
  })
  .superRefine(eventNeedsDate);
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    content: z.string().trim().min(1).max(50_000),
    type: announcementTypeSchema,
    eventDate: z.string().datetime({ offset: true }).nullable(),
  })
  .partial()
  .superRefine(eventNeedsDate);
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

export const publishAnnouncementSchema = z.object({ published: z.boolean() });
export type PublishAnnouncementInput = z.infer<typeof publishAnnouncementSchema>;

export const listAnnouncementsQuerySchema = paginationQuerySchema.extend({
  type: announcementTypeSchema.optional(),
  authorId: idSchema.optional(),
  published: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Filters EVENT rows to those whose `eventDate` has not passed. */
  upcoming: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
