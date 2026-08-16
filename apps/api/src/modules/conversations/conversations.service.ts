import { prisma, type Prisma } from '@skillwright/db';
import {
  paginationMeta,
  toSkipTake,
  type Actor,
  type CursorPaginated,
  type Paginated,
  type Subject,
} from '@skillwright/shared';
import { ulid } from 'ulid';
import { USER_SUMMARY_SELECT, toUserSummary } from '../../lib/dto.js';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import type {
  ConversationDto,
  CreateConversationInput,
  JoinConversationInput,
  ListConversationsQuery,
  ListMessagesQuery,
  MarkReadInput,
  MessageDto,
  ParticipantDto,
  SendMessageInput,
} from './conversations.schema.js';

/**
 * `as const` matters: Prisma derives the payload type from the literal shape, and
 * without it `ConversationGetPayload` widens to `boolean` and the mappers stop being
 * checked against the columns they read.
 *
 * `messages` is a take-1 window, not the thread: `conversationSchema.lastMessage`
 * (conversation.ts:30) is a whole `MessageDto`, so the newest live row is loaded with
 * its sender and mapped by the same function the message list uses. Message HAS a
 * `deletedAt` column and the ORM does not enforce soft delete, so the filter is
 * written by hand here exactly as it is in every other read in this file.
 *
 * Participants are loaded whole — including the ones who left — because
 * `participantSchema` carries `leftAt` (conversation.ts:17) and the SPA renders a
 * thread's history of members. Only ACTIVE rows (`leftAt: null`, actor.ts:90) go into
 * the policy Subject; that narrowing lives in `loadConversationSubject`.
 */
const CONVERSATION_INCLUDE = {
  // `select`, not `include`: the mapper reads three columns, and `user: true` would
  // load passwordHash and totpSecret for every participant of every page. See
  // USER_SUMMARY_SELECT in lib/dto.ts.
  participants: {
    include: { user: { select: USER_SUMMARY_SELECT } },
    orderBy: { joinedAt: 'asc' },
  },
  messages: {
    where: { deletedAt: null },
    orderBy: { seq: 'desc' },
    take: 1,
    include: { sender: { select: USER_SUMMARY_SELECT } },
  },
} as const;

type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

const MESSAGE_INCLUDE = { sender: { select: USER_SUMMARY_SELECT } } as const;

type MessageWithSender = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

type ParticipantWithUser = ConversationWithRelations['participants'][number];

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/*
 * `toUserSummary` is imported from lib/dto.ts. It is a nested piece of four other DTOs
 * besides this module's, and it has to exist in exactly one place.
 *
 * Every BigInt column is emitted with `.toString()`. `MessageDto['seq']` and
 * `ParticipantDto['lastReadSeq']` are declared as strings (bigIntStringSchema,
 * common.ts:50-53) because a Postgres bigint exceeds Number.MAX_SAFE_INTEGER — and
 * because `JSON.stringify` throws outright on a raw BigInt, so the alternative is not
 * a wrong number but a 500.
 *
 * Dates are stringified even though the response schema would normalise a `Date` on
 * its own: the return types are the shared DTOs whose fields are `string`, so a
 * binding mistake is a compile error here rather than a response-validation 500
 * (lib/dto.ts:78-82).
 */

/** The ONLY shape a message is serialised as. */
export function toMessageDto(message: MessageWithSender): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    // Nested `sender`, not senderId/senderName — message.ts:14. apps/web reads
    // `message.senderId` and `message.senderName` today; the shared schema is the
    // contract of record and the SPA is what changes.
    sender: toUserSummary(message.sender),
    seq: message.seq.toString(),
    content: message.content,
    clientMsgId: message.clientMsgId,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

/** The ONLY shape a participant is serialised as. */
function toParticipantDto(participant: ParticipantWithUser): ParticipantDto {
  return {
    // Nested `user`, not a flattened person — conversation.ts:13.
    user: toUserSummary(participant.user),
    lastReadSeq: participant.lastReadSeq.toString(),
    lastReadAt: participant.lastReadAt?.toISOString() ?? null,
    joinedAt: participant.joinedAt.toISOString(),
    leftAt: participant.leftAt?.toISOString() ?? null,
  };
}

/**
 * The ONLY shape a conversation is serialised as.
 *
 * `unreadCount` is a parameter rather than a column because it is the REQUESTING
 * actor's state measured against this thread (conversation.ts:31-32), which no
 * `include` can express. It is computed in bulk by `unreadCounts` below.
 */
export function toConversationDto(
  conversation: ConversationWithRelations,
  unreadCount: number,
): ConversationDto {
  // noUncheckedIndexedAccess: the take-1 window is `MessageWithSender | undefined`.
  const [latest] = conversation.messages;
  return {
    id: conversation.id,
    title: conversation.title,
    participants: conversation.participants.map(toParticipantDto),
    lastMessage: latest ? toMessageDto(latest) : null,
    unreadCount,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Unread counts
// ---------------------------------------------------------------------------

/**
 * schema.prisma:553 — "Unread count is a range query". It is `COUNT(*)` over the live
 * messages above the viewer's own high-water mark, and NOT `nextSeq - 1 - lastReadSeq`:
 * that arithmetic counts soft-deleted messages, so a moderated thread would show a
 * badge that no amount of reading can clear.
 *
 * ONE `groupBy` for the whole page rather than N+1 counts. The threshold differs per
 * conversation, which `groupBy` cannot express as a single predicate — so the per-row
 * thresholds are sent as an `OR` of `(conversationId, seq > mark)` pairs, which is one
 * statement and lets Postgres use `Message_conversationId_seq_idx` (schema.prisma:588)
 * for each arm. The alternative was `$queryRaw`; this keeps the soft-delete filter in
 * the same language as every other read.
 *
 * Rows where the viewer is not an ACTIVE participant contribute nothing and are
 * reported as 0 — that is the honest answer for an admin looking at a thread they
 * were never seated in.
 */
async function unreadCounts(
  actor: Actor,
  conversations: readonly ConversationWithRelations[],
): Promise<Map<string, number>> {
  const thresholds: Prisma.MessageWhereInput[] = [];
  for (const conversation of conversations) {
    const viewer = conversation.participants.find(
      (participant) => participant.userId === actor.id && participant.leftAt === null,
    );
    if (viewer) {
      thresholds.push({ conversationId: conversation.id, seq: { gt: viewer.lastReadSeq } });
    }
  }
  if (thresholds.length === 0) return new Map();

  const groups = await prisma.message.groupBy({
    by: ['conversationId'],
    where: { deletedAt: null, OR: thresholds },
    _count: { _all: true },
    orderBy: { conversationId: 'asc' },
  });

  // The tuple annotation is load-bearing: without it the callback infers
  // `(string | number)[]` and `new Map(...)` stops producing `Map<string, number>`.
  return new Map(
    groups.map((group): [string, number] => [group.conversationId, group._count._all]),
  );
}

/** One conversation, loaded and mapped for one viewer. Used by every write path. */
async function conversationDto(actor: Actor, conversationId: string): Promise<ConversationDto> {
  // Conversation has NO `deletedAt` column (schema.prisma:524-540), so `findUnique` is
  // correct here — unlike Course, where a soft-deleted row must read as absent.
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: CONVERSATION_INCLUDE,
  });
  if (!conversation) throw notFound('Conversation');

  const counts = await unreadCounts(actor, [conversation]);
  return toConversationDto(conversation, counts.get(conversation.id) ?? 0);
}

// ---------------------------------------------------------------------------
// Subjects — loaded here, decided by can() in the auth plugin
// ---------------------------------------------------------------------------

/**
 * Subject for `conversation:read` and `conversation:send` (policy.ts:397-416).
 *
 * `participantIds` is the ONLY field `isParticipant` reads (combinators.ts:82-85). A
 * wrong key here is a SILENT 403, never a type error, because every Subject field is
 * optional (actor.ts:46-51).
 *
 * Only rows with `leftAt: null` belong in it — actor.ts:90 defines the field as "active
 * participants of a Conversation". Seating history is not membership: someone who left
 * a thread must stop being able to read it.
 *
 * Returns `undefined` for a missing conversation so the POLICY denies (403), rather
 * than this loader throwing a bare 404 before the gate has run (courses.service.ts:82-91).
 */
export async function loadConversationSubject(
  conversationId: string,
): Promise<Subject | undefined> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, participants: { where: { leftAt: null }, select: { userId: true } } },
  });
  if (!conversation) return undefined;

  return {
    id: conversation.id,
    participantIds: conversation.participants.map((participant) => participant.userId),
  };
}

// ---------------------------------------------------------------------------
// Listing conversations
// ---------------------------------------------------------------------------

/**
 * The WHERE clause that mirrors the `conversation:read` row rules, policy.ts:397-404:
 *
 *   STUDENT -> isParticipant -> an active participant row for the actor
 *   TEACHER -> isParticipant -> the same
 *   ADMIN   -> isParticipant -> the same. policy.ts:401-403: "Admins moderate threads
 *              they were seated in; the schema can seat them, so there is no need for
 *              a bypass." There is deliberately no admin widening below.
 *
 * A cross-conversation list cannot go through `authorize('conversation:read')` with an
 * empty subject: `isParticipant` reads `Subject.participantIds`, and a rule that reads
 * an absent field must deny (actor.ts:46-51), so EVERY caller — admins included —
 * would get a 403 on their own inbox. The route gates on authentication instead
 * (enrollments.routes.ts:32-50) and the policy becomes this clause.
 *
 * Reading nothing but `actor.id` here is choosing which WHERE mirrors which policy
 * row; it is NOT a permission check. If this function and policy.ts ever disagree,
 * THIS FUNCTION IS THE BUG. That is why the mirror lives in exactly one named place.
 */
function visibilityWhere(actor: Actor): Prisma.ConversationWhereInput {
  return { participants: { some: { userId: actor.id, leftAt: null } } };
}

/**
 * `unreadOnly` is an id-set prefilter, not a post-map filter.
 *
 * Dropping unread rows after mapping would leave `meta.total` counting rows the caller
 * never received, so page 2 would skip records and the client's "N conversations"
 * would be a lie. The predicate itself — "a live message exists above MY mark in THIS
 * thread" — correlates two relations and is not expressible in a Prisma `where`, so
 * the ids are resolved first with the SAME definition `unreadCounts` uses (live
 * messages only) and handed to the main query as `id: { in: … }`.
 *
 * Cost: two extra statements, bounded by how many threads the caller is seated in.
 * That is the honest price of a filter the ORM cannot express; the alternative was to
 * not support the flag at all.
 */
async function unreadConversationIds(actor: Actor): Promise<string[]> {
  const seats = await prisma.conversationParticipant.findMany({
    where: { userId: actor.id, leftAt: null },
    select: { conversationId: true, lastReadSeq: true },
  });
  if (seats.length === 0) return [];

  const groups = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      deletedAt: null,
      OR: seats.map((seat) => ({
        conversationId: seat.conversationId,
        seq: { gt: seat.lastReadSeq },
      })),
    },
    _count: { _all: true },
    orderBy: { conversationId: 'asc' },
  });
  return groups.map((group) => group.conversationId);
}

async function listWhere(
  actor: Actor,
  query: ListConversationsQuery,
): Promise<Prisma.ConversationWhereInput> {
  const filters: Prisma.ConversationWhereInput[] = [visibilityWhere(actor)];

  if (query.unreadOnly === true) {
    // `in: []` matches nothing, which is the correct answer for "no unread threads".
    filters.push({ id: { in: await unreadConversationIds(actor) } });
  }

  if (query.q !== undefined) {
    filters.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        {
          // User HAS a `deletedAt` column and the ORM does not enforce soft delete, so
          // a removed account must not make a thread findable by their old name.
          participants: {
            some: { user: { name: { contains: query.q, mode: 'insensitive' }, deletedAt: null } },
          },
        },
      ],
    });
  }

  // The filters are a separate AND term rather than a spread, so they can only narrow
  // within the visible set and never widen it — and so a filter's own top-level `OR`
  // cannot silently replace visibility's.
  return { AND: filters };
}

type SortDirection = ListConversationsQuery['order'];

/**
 * `sort` arrives as free-form text (pagination.ts:16), so it is matched against this
 * map and never interpolated into an `orderBy` key. An unrecognised value falls back
 * rather than 422ing.
 */
const ORDER_BY: Record<
  string,
  (order: SortDirection) => Prisma.ConversationOrderByWithRelationInput
> = {
  lastMessageAt: (order) => ({ lastMessageAt: order }),
  createdAt: (order) => ({ createdAt: order }),
  title: (order) => ({ title: order }),
};

/** `@@index([lastMessageAt])` exists for exactly this default (schema.prisma:539). */
const DEFAULT_ORDER = (order: SortDirection): Prisma.ConversationOrderByWithRelationInput => ({
  lastMessageAt: order,
});

function orderFor(query: ListConversationsQuery): Prisma.ConversationOrderByWithRelationInput {
  const build = query.sort === undefined ? undefined : ORDER_BY[query.sort];
  return (build ?? DEFAULT_ORDER)(query.order);
}

export async function list(
  actor: Actor,
  query: ListConversationsQuery,
): Promise<Paginated<ConversationDto>> {
  const where = await listWhere(actor, query);

  const [rows, total] = await prisma.$transaction([
    prisma.conversation.findMany({
      where,
      ...toSkipTake(query),
      orderBy: orderFor(query),
      include: CONVERSATION_INCLUDE,
    }),
    prisma.conversation.count({ where }),
  ]);

  // Outside the transaction on purpose. The batched read is not part of the snapshot
  // the page needs, and issuing it inside an interactive transaction would be the
  // second-connection mistake the audit extension already makes expensive.
  const counts = await unreadCounts(actor, rows);

  return {
    data: rows.map((row) => toConversationDto(row, counts.get(row.id) ?? 0)),
    meta: paginationMeta(query.page, query.limit, total),
  };
}

// ---------------------------------------------------------------------------
// Creating a conversation
// ---------------------------------------------------------------------------

/**
 * conversation.ts:40-42 — "A direct thread between the same two people is
 * deduplicated server-side rather than by the client remembering the id."
 *
 * A direct thread is an untitled conversation whose ACTIVE participant set is exactly
 * the requested pair. Prisma cannot compare a relation's cardinality inside a `where`,
 * so the two `some` arms narrow to candidates and the `_count` — filtered by hand,
 * because soft-delete and left-participant filters are never implicit — picks the one
 * that is a pair and not a group that happens to contain both people.
 */
async function findDirectConversation(participantIds: string[]): Promise<string | undefined> {
  const candidates = await prisma.conversation.findMany({
    where: {
      title: null,
      AND: participantIds.map((userId) => ({ participants: { some: { userId, leftAt: null } } })),
    },
    select: { id: true, _count: { select: { participants: { where: { leftAt: null } } } } },
    // Oldest wins, so two racing creates converge on one thread rather than alternating.
    orderBy: { createdAt: 'asc' },
  });
  return candidates.find((row) => row._count.participants === participantIds.length)?.id;
}

/**
 * One nested create, so the thread and its seats are a single statement and a
 * half-seated conversation is not a reachable state. Conversation and
 * ConversationParticipant are NOT in AUDITED_MODELS (audit.ts:51-59), so this write
 * does not touch the audit extension's second pool.
 */
async function seatNewConversation(
  title: string | null,
  participantIds: string[],
): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: { title, participants: { create: participantIds.map((userId) => ({ userId })) } },
    select: { id: true },
  });
  return conversation.id;
}

export async function create(
  actor: Actor,
  input: CreateConversationInput,
): Promise<ConversationDto> {
  // conversation.ts:38-42 — "The creator is always seated; `participantIds` names the
  // others." A client that also lists themself gets one seat, not a unique violation.
  const participantIds = [...new Set([actor.id, ...input.participantIds])];

  // A client-chosen foreign key is checked FIRST so it becomes a field-level 422
  // rather than a foreign-key 500 (courses.service.ts:296-315).
  const known = await prisma.user.findMany({
    where: { id: { in: participantIds }, deletedAt: null },
    select: { id: true },
  });
  if (known.length !== participantIds.length) {
    throw validationFailed([{ path: 'participantIds', message: 'Unknown user' }]);
  }

  const existingDirectId =
    input.title === undefined && participantIds.length === 2
      ? await findDirectConversation(participantIds)
      : undefined;

  const conversationId =
    existingDirectId ?? (await seatNewConversation(input.title ?? null, participantIds));

  if (input.message !== undefined) {
    // conversation.ts:46 — "Optional opening message, so starting a chat is one request
    // rather than two." It goes through the SAME seq-claiming path as
    // POST /conversations/:id/messages; duplicating that logic is how the two paths
    // start handing out different sequence numbers.
    //
    // `createConversationSchema` carries no idempotency key, so one is minted here.
    // A retried create therefore posts a second opening line — which is why the
    // deduplication above returns the EXISTING thread rather than a second one, and
    // why the SPA should send `clientMsgId` through the message endpoint for anything
    // it needs to retry safely.
    await sendMessage(actor, conversationId, { content: input.message, clientMsgId: ulid() });
  }

  return conversationDto(actor, conversationId);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Cursor paging, not offset — pagination.ts:70-73: "a conversation grows while you
 * read it, and offset paging in a growing list re-serves rows you have already seen."
 *
 * Two directions, one query (message.ts:45): `cursor` pages BACKWARDS through history
 * (`seq < cursor`, newest first) and `after` backfills forward after a reconnect
 * (`seq > after`, oldest first). Sending both is a bounded range and is answered in
 * the backfill direction, because that is the only direction in which "everything
 * after X" has a meaning.
 *
 * `limit + 1` rows are fetched to learn whether another page exists without a second
 * COUNT over a table that is append-only and hot.
 */
export async function listMessages(
  conversationId: string,
  query: ListMessagesQuery,
): Promise<CursorPaginated<MessageDto>> {
  const backfilling = query.after !== undefined;

  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      // Message HAS `deletedAt` (schema.prisma:584) and the ORM does not enforce soft
      // delete, so the tombstone filter is written by hand.
      deletedAt: null,
      ...(query.cursor !== undefined ? { seq: { lt: BigInt(query.cursor) } } : {}),
      ...(query.after !== undefined ? { seq: { gt: BigInt(query.after) } } : {}),
    },
    orderBy: { seq: backfilling ? 'asc' : 'desc' },
    take: query.limit + 1,
    include: MESSAGE_INCLUDE,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  // noUncheckedIndexedAccess: `MessageWithSender | undefined` even on a non-empty page.
  const last = page[page.length - 1];

  return {
    data: page.map(toMessageDto),
    // Null when the list is exhausted (pagination.ts:82-83), so a client can stop
    // without comparing lengths.
    meta: { nextCursor: hasMore && last ? last.seq.toString() : null, hasMore },
  };
}

/**
 * message.ts:26-30 — "Retrying a send after a timeout therefore returns the original
 * message instead of double-posting." The idempotency check runs FIRST, before any
 * sequence number is claimed, or a retry burns a seq and leaves a gap in a column the
 * schema promises is gap-free.
 */
export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: SendMessageInput,
): Promise<MessageDto> {
  const replayed = await prisma.message.findUnique({
    where: { senderId_clientMsgId: { senderId: actor.id, clientMsgId: input.clientMsgId } },
    include: MESSAGE_INCLUDE,
  });
  if (replayed) {
    // @@unique([senderId, clientMsgId]) (schema.prisma:587) is global to the sender,
    // not scoped to a thread. A key reused across threads is a client bug, and
    // answering it with the OTHER thread's message would have the SPA render a reply
    // in the wrong conversation. 409 says so out loud.
    if (replayed.conversationId !== conversationId) {
      throw conflict('This clientMsgId was already used in another conversation');
    }
    return toMessageDto(replayed);
  }

  /*
   * DEFAULT transaction budget on purpose — do NOT add `TX_OPTIONS` here by cargo cult
   * from enrollments.service.ts:41-50. Conversation, ConversationParticipant and
   * Message are all absent from AUDITED_MODELS (audit.ts:51-59), so nothing inside this
   * callback writes on the audit extension's SECOND pool. The generous budget exists to
   * absorb that second connection; there is none to absorb here, and three statements
   * against one row do not need fifteen seconds.
   *
   * A P2002 on @@unique([senderId, clientMsgId]) from a true race past the findUnique
   * above is already a 409 (errors.plugin.ts:47-51). It is not caught and re-mapped.
   */
  return prisma.$transaction(async (tx) => {
    /*
     * ADR-0006 style: THE UPDATE IS THE ALLOCATION. There is no `SELECT nextSeq`
     * followed by a write — the read-then-write shape loses the race every time under
     * load, and `@@unique([conversationId, seq])` (schema.prisma:586) turns the loss
     * into a 409 for a message the user did nothing wrong to send.
     *
     * A tagged template, never $executeRawUnsafe, and `conversationId` is a bound
     * parameter rather than interpolated text. RETURNING sees the NEW row, so the seq
     * just claimed is `nextSeq - 1`.
     *
     * `lastMessageAt` moves in the same statement because the list orders on it
     * (schema.prisma:539) and a separate UPDATE would let a thread sort stale between
     * the two writes.
     */
    const claimed = await tx.$queryRaw<Array<{ seq: bigint }>>`
      UPDATE "Conversation"
         SET "nextSeq" = "nextSeq" + 1, "lastMessageAt" = now()
       WHERE id = ${conversationId}
      RETURNING "nextSeq" - 1 AS seq`;

    const allocated = claimed[0];
    // Zero rows means the conversation vanished between the policy gate and here.
    if (!allocated) throw notFound('Conversation');

    const message = await tx.message.create({
      data: {
        conversationId,
        senderId: actor.id,
        seq: allocated.seq,
        content: input.content,
        clientMsgId: input.clientMsgId,
      },
      include: MESSAGE_INCLUDE,
    });

    /*
     * Sending is reading. Without this the sender's own message counts against their
     * unread badge, and the only way to clear it is an explicit mark-read they have no
     * reason to send — the badge never reaches zero on a thread you are talking in.
     */
    await tx.conversationParticipant.updateMany({
      where: { conversationId, userId: actor.id, leftAt: null },
      data: { lastReadSeq: allocated.seq, lastReadAt: new Date() },
    });

    return toMessageDto(message);
  });
}

// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------

/**
 * Moves the caller's own high-water mark. Without this endpoint `unreadCount` and the
 * bell badge never fall to zero on a thread the user only reads.
 */
export async function markRead(
  actor: Actor,
  conversationId: string,
  input: MarkReadInput,
): Promise<ConversationDto> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { nextSeq: true },
  });
  if (!conversation) throw notFound('Conversation');

  // `nextSeq` is the NEXT seq to hand out (schema.prisma:528-531), so live messages
  // occupy 1 .. nextSeq-1. Clamping stops a client that posts a seq from the future
  // from permanently suppressing its own unread count for messages not yet written.
  const requested = BigInt(input.seq);
  const highWater = conversation.nextSeq - 1n;
  const target = requested > highWater ? highWater : requested;

  await prisma.conversationParticipant.updateMany({
    where: {
      conversationId,
      // Scoping to the actor is what stops one participant moving another's mark.
      // The gate proved they are seated here; it did not say whose row they may touch.
      userId: actor.id,
      leftAt: null,
      // Never backwards: a slow in-flight receipt from an older render would otherwise
      // resurrect messages the user has already seen.
      lastReadSeq: { lt: target },
    },
    data: { lastReadSeq: target, lastReadAt: new Date() },
  });

  return conversationDto(actor, conversationId);
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/**
 * ADMIN-only (policy.ts:417-424): "Self-joining an arbitrary thread is the whole
 * attack. Only an admin adds a participant, and only to a thread that already exists."
 * The gate is role-only, so there is no subject loader — which is exactly why the
 * conversation's existence is checked HERE and answered as a 404.
 */
export async function addParticipant(
  actor: Actor,
  conversationId: string,
  input: JoinConversationInput,
): Promise<ConversationDto> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!conversation) throw notFound('Conversation');

  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw validationFailed([{ path: 'userId', message: 'Unknown user' }]);

  await prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId: input.userId } },
    create: { conversationId, userId: input.userId },
    // Re-adding someone who left CLEARS `leftAt` rather than colliding on
    // @@unique([conversationId, userId]) (schema.prisma:559). `lastReadSeq` is left
    // where they abandoned it, so they come back to the messages they missed rather
    // than to a thread that claims it is fully read.
    update: { leftAt: null },
  });

  const dto = await conversationDto(actor, conversationId);

  /*
   * policy.ts:397-404 — `conversation:read` is `isParticipant` for ADMIN too. An admin
   * may SEAT someone into a thread they are not in, but seating someone does not earn
   * the right to read it, and `lastMessage` is message content. It is withheld rather
   * than the whole response being a 204, because the caller still needs to see that
   * the seat now exists.
   */
  const seated = dto.participants.some(
    (participant) => participant.user.id === actor.id && participant.leftAt === null,
  );
  return seated ? dto : { ...dto, lastMessage: null };
}
