import { z } from 'zod';
import { idSchema, isoDateTimeSchema, nullableIsoDateTimeSchema } from './common.js';
import { paginationQuerySchema } from './pagination.js';

export const notificationTypeSchema = z.enum([
  'ENROLLMENT_REQUESTED',
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'ENROLLMENT_WITHDRAWN',
  'ENROLLMENT_COMPLETED',
  'COURSE_PUBLISHED',
  'RESOURCE_PUBLISHED',
  'ANNOUNCEMENT_PUBLISHED',
  'MESSAGE_RECEIVED',
  'COMMENT_REPLIED',
  'COMMENT_POSTED',
  'ACCOUNT_SUSPENDED',
  // Phase 3, and the member Phase 2 recorded as needing "a migration nobody asked
  // for". Awarding a qualification is the one event in the chain a student cannot
  // discover any other way: the PDF exists and the Qualifications tab exists, and
  // neither of them interrupts anybody. The revocation is a second member rather than
  // a second row under this one because the notifications page filters by type.
  'CERTIFICATE_ISSUED',
  'CERTIFICATE_REVOKED',
]);
export type NotificationTypeValue = z.infer<typeof notificationTypeSchema>;

/**
 * The payload is denormalised on write, so rendering a notification never joins to
 * a row that may since have been soft-deleted. `title` and `body` are the only keys
 * the SPA needs, and they are the only two that reach it.
 *
 * Deliberately NOT `.catchall(z.unknown())`. `Notification.payload` is an
 * unconstrained `Json` column written by other modules' side effects, so a passthrough
 * would make every future producer free to denormalise a target's email address or a
 * verification link into it and have that served to the client unfiltered. Extra
 * context keys may be stored — they are simply stripped on the way out, which is what
 * every other DTO in the system already does.
 */
export const notificationPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
});
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
