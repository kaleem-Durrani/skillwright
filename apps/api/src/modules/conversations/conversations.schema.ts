/**
 * The conversations module binds request and response shapes from @skillwright/shared
 * rather than declaring its own. A second definition of what a message body is would
 * drift from the SPA's within a sprint, and the drift would only surface at runtime.
 *
 * This file exists to name the exact subset the routes bind, so the wire surface of
 * the module is readable in one place. Helpers that are not wire shapes — `paginated`,
 * `cursorPaginated`, `paginationMeta`, `toSkipTake`, `Actor`, `Subject` — are imported
 * straight from '@skillwright/shared' at their point of use; re-exporting a function
 * through here would make this file look like an API when it is an index.
 */
import { z } from 'zod';
import { idSchema } from '@skillwright/shared';

/**
 * THE ONE LOCAL DECLARATION, and the reason it is allowed.
 *
 * `@skillwright/shared` exports `idParamSchema` (`{ id }`, common.ts:24) and
 * `slugParamSchema` (`{ slug }`, common.ts:34) and nothing for a nested param name —
 * there is no shared `{ conversationId }`. The leaf rule is still imported rather than
 * restated, so the cuid-or-ULID definition (common.ts:20-22) lives in exactly one file.
 * The precedent is `courseIdParamSchema` in courses.schema.ts:49-55.
 */
export const conversationIdParamSchema = z.object({ conversationId: idSchema });
export type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;

export {
  // conversation.ts
  conversationSchema,
  createConversationSchema,
  joinConversationSchema,
  listConversationsQuerySchema,
  participantSchema,
  // message.ts — the two message routes hang off the /conversations prefix, so their
  // wire shapes are this module's surface even though they live in another file.
  listMessagesQuerySchema,
  markReadSchema,
  messageSchema,
  sendMessageSchema,
} from '@skillwright/shared';

export type {
  ConversationDto,
  CreateConversationInput,
  JoinConversationInput,
  ListConversationsQuery,
  ParticipantDto,
  ListMessagesQuery,
  MarkReadInput,
  MessageDto,
  SendMessageInput,
  UserSummary,
} from '@skillwright/shared';
