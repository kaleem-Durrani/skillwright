import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const notificationTypeSchema = z.enum([
  'ENROLLMENT_REQUESTED',
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'RESOURCE_PUBLISHED',
  'ANNOUNCEMENT_PUBLISHED',
  'MESSAGE_RECEIVED',
  'COMMENT_REPLIED',
  'ACCOUNT_SUSPENDED',
]);
export type NotificationTypeValue = z.infer<typeof notificationTypeSchema>;

/**
 * The payload is denormalised on write, so rendering a notification never joins to
 * a row that may since have been soft-deleted. `title` and `body` are the only
 * keys the SPA needs; anything else is type-specific context.
 */
export const notificationPayloadSchema = z
  .object({
    title: z.string(),
    body: z.string(),
  })
  .catchall(z.unknown());
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const notificationSchema = z.object({
  id: idSchema,
  type: notificationTypeSchema,
  payload: notificationPayloadSchema,
  linkPath: z.string().nullable(),
  readAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  type: notificationTypeSchema.optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * Marking read is a bulk verb: omitting `ids` marks everything. Two endpoints for
 * "this one" and "all of them" would be the same transaction written twice.
 */
export const markNotificationsReadSchema = z.object({
  ids: z.array(idSchema).min(1).max(200).optional(),
  read: z.boolean().default(true),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export const unreadCountResponseSchema = z.object({
  unread: z.number().int(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
