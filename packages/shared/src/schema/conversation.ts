import { z } from 'zod';
import {
  bigIntStringSchema,
  idSchema,
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
} from './common.js';
import { messageSchema } from './message.js';
import { paginationQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

export const participantSchema = z.object({
  user: userSummarySchema,
  lastReadSeq: bigIntStringSchema,
  lastReadAt: nullableIsoDateTimeSchema,
  joinedAt: isoDateTimeSchema,
  leftAt: nullableIsoDateTimeSchema,
});
export type ParticipantDto = z.infer<typeof participantSchema>;

/**
 * N participants, not a (teacher, student) pair. The pair-shaped table in the old
 * system is the reason its admin chat shipped as a placeholder.
 */
export const conversationSchema = z.object({
  id: idSchema,
  /** Null for a direct thread; the SPA renders the other participant's name instead. */
  title: z.string().nullable(),
  participants: z.array(participantSchema),
  lastMessage: messageSchema.nullable(),
  /** Derived from the viewer's `lastReadSeq` against the conversation high-water mark. */
  unreadCount: z.number().int(),
  lastMessageAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});
export type ConversationDto = z.infer<typeof conversationSchema>;

/**
 * The creator is always seated; `participantIds` names the others. A direct thread
 * between the same two people is deduplicated server-side rather than by the
 * client remembering the id.
 */
export const createConversationSchema = z.object({
  participantIds: z.array(idSchema).min(1).max(50),
  title: z.string().trim().min(1).max(160).optional(),
  /** Optional opening message, so starting a chat is one request rather than two. */
  message: z.string().trim().min(1).max(4000).optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

/** Admin-only: seats a participant into an existing thread. */
export const joinConversationSchema = z.object({
  userId: idSchema,
});
export type JoinConversationInput = z.infer<typeof joinConversationSchema>;

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
