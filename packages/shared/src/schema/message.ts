import { z } from 'zod';
import {
  bigIntStringSchema,
  idSchema,
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
} from './common.js';
import { cursorQuerySchema } from './pagination.js';
import { userSummarySchema } from './user.js';

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  sender: userSummarySchema,
  /** Gap-free per conversation, so backfill after a reconnect is an exact range query. */
  seq: bigIntStringSchema,
  content: z.string(),
  /** Echoed back so the client can reconcile its optimistic row. */
  clientMsgId: z.string(),
  createdAt: isoDateTimeSchema,
  editedAt: nullableIsoDateTimeSchema,
  deletedAt: nullableIsoDateTimeSchema,
});
export type MessageDto = z.infer<typeof messageSchema>;

/**
 * `clientMsgId` is a client-generated ULID and is UNIQUE per sender in the schema.
 * Retrying a send after a timeout therefore returns the original message instead
 * of double-posting — the idempotency key is required, not optional.
 */
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  clientMsgId: z
    .string()
    .trim()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'clientMsgId must be a ULID.'),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

/** `before` pages backwards through history; `after` backfills after a reconnect. */
export const listMessagesQuerySchema = cursorQuerySchema.extend({
  after: z.string().regex(/^\d+$/).optional(),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

/** One high-water mark per participant replaces per-message read rows entirely. */
export const markReadSchema = z.object({
  seq: z.union([z.bigint(), z.number().int(), z.string().regex(/^\d+$/)]).transform(String),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;
