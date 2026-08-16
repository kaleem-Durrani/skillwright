/**
 * The notifications module binds request and response shapes from @skillwright/shared
 * rather than declaring its own. A second definition of what a notification is would
 * drift from the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported straight from
 * '@skillwright/shared' at their point of use; re-exporting a function through here
 * would make this file look like an API when it is an index.
 *
 * Two notes on the subset below.
 *
 * `notificationPayloadSchema` is bound by no route directly — it is the `payload` field
 * inside `notificationSchema`. It is named here anyway because the service PARSES with
 * it at runtime (`toPayload` in notifications.service.ts): `Notification.payload` is
 * Prisma `Json` (schema.prisma:604), so the column type carries no guarantee that
 * `{ title, body }` is present.
 *
 * There is NO local zod declaration in this file, unlike courses.schema.ts:49-55 and
 * enrollments.schema.ts:15-27. Those two needed a `{ courseId }` param shape that
 * shared does not export. No route in this module takes a path param at all: marking
 * read is a bulk verb on the collection (notification.ts:49-52), so there is no
 * `/:id` route and therefore no gap to fill.
 */

export {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  notificationPayloadSchema,
  notificationSchema,
  notificationTypeSchema,
  unreadCountResponseSchema,
} from '@skillwright/shared';

export type {
  ListNotificationsQuery,
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationPayload,
  NotificationTypeValue,
  UnreadCountResponse,
} from '@skillwright/shared';
