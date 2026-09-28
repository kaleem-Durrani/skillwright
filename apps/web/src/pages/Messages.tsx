import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ArrowLeft, SendHorizonal, UserRoundPlus } from 'lucide-react';
import { ulid } from 'ulid';
/*
 * The two response envelopes, taken from the package that DEFINES them.
 *
 * `@/lib/api` carries its own copies, and the cursor one is wrong: `CursorPage<T>` is
 * `{ data, nextCursor }` while the endpoint sends `{ data, meta: { nextCursor, hasMore } }`
 * (pagination.ts:88-95, bound at conversations.routes.ts:81). Importing the shared
 * declarations is the same rule the rest of this file now follows — CONTRIBUTING.md:51,
 * "a type hand-written on the client that the schema already describes".
 *
 * Type-only, so this specifier erases at build time and pulls no zod into the bundle.
 */
import type { CursorPaginated, MarkReadInput, Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { useCan } from '@/lib/policy';
import { formatRelative, formatTime } from '@/lib/format';
import type { ConversationDto, MessageDto, ParticipantDto, SendMessageInput } from '@/lib/types';
import { AddParticipantDialog } from '@/components/conversations/AddParticipantDialog';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonList, SkeletonThread } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_app/messages';

/**
 * One route, two layouts.
 *
 * BASE (< md): a single pane. The list IS the screen; opening a thread replaces
 * it, and the back control returns. Two panes at 375px means a 140px thread.
 * MD AND UP: list and thread side by side, because the width now exists.
 *
 * Which pane is showing is a URL search param, not component state, so the back
 * button does the obvious thing and a thread link can be shared.
 */
export function MessagesPage() {
  const { conversationId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Needed to answer "which of these participants is not me" — see `counterparts`.
  const { user } = useSession();
  // Local, not a search param: `MessagesSearch` (routes/_app/messages.tsx) carries
  // only `conversationId` — opening a thread must stay linkable on its own — and
  // this page does not own that route file. A page flip is not a link anyone needs
  // to share, so component state is the right home for it.
  const [page, setPage] = useState(1);

  /*
   * THE OPEN THREAD'S ROSTER, HELD SEPARATELY FROM THE LIST, and the reason is
   * that there is no `GET /conversations/:conversationId`.
   *
   * The read routes on this module are `GET /conversations` (the list),
   * `/:id/messages` and `/:id/read` — and the last of those answers with the
   * REFRESHED conversation, which is how the badge below is reconciled by
   * `writeConversationRow`. So the membership of a thread is knowable from exactly
   * one place in the SPA, and that place is the page. A `?conversationId=` link to
   * a thread on another page of the list, or a roster that has just gained a
   * participant, would both leave this state stale if it were derived from the
   * current list page alone.
   *
   * `null` means "not loaded" and is DIFFERENT from "loaded and empty": the header
   * falls back to the generic label rather than claiming a thread has nobody in
   * it, which is the failure a `?? []` would produce.
   */
  const [thread, setThread] = useState<ConversationDto | null>(null);
  const queryClient = useQueryClient();

  /*
   * No `enabled: policy.can('conversation:read')` here, deliberately — the client-side
   * mirror of the argument conversations.routes.ts:31-46 makes on the server.
   *
   * `conversation:read` is `isParticipant` for all three roles (policy.ts:397-404), and
   * `isParticipant` reads `Subject.participantIds` (combinators.ts:82-85). A
   * cross-conversation LIST has no single subject to pass, and `can()` substitutes
   * EMPTY_SUBJECT when the third argument is omitted (can.ts:53) — a rule that reads an
   * absent field must deny, so the subject-free call was false for EVERY user, admins
   * included. That is not a hidden button: an `enabled: false` query stays
   * `status: 'pending'` in React Query v5, so `conversations.isPending` never cleared and
   * this pane rendered its skeleton forever for all three roles.
   *
   * GET /conversations is authentication-gated and the policy is already a WHERE clause
   * there (`visibilityWhere`, mirroring policy.ts:397-404 row for row), so the rows that
   * arrive are exactly the threads this actor is seated in. Just run the query.
   *
   * A subject-free `can()` is only correct for an action that is subject-INDEPENDENT for
   * every role — a bare allow/deny, e.g. 'conversation:create' (policy.ts:405-410).
   */
  const conversations = useQuery({
    // `qk.conversations` (lib/query.ts) has no parameter slot for a page — it
    // predates this list needing one. Extended here rather than there, since this
    // page does not own that file; the `send` mutation's
    // `invalidateQueries({ queryKey: qk.conversations })` below still reaches this
    // key, because TanStack Query matches by PREFIX and `qk.conversations` is this
    // key's first element.
    queryKey: ['conversations', { page }],
    queryFn: () =>
      api.get<Paginated<ConversationDto>>('/conversations', { query: { page, limit: 20 } }),
    // Keeps the previous page on screen while the next one loads, same as Courses.tsx.
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  });

  const open = (id: string | undefined) =>
    void navigate({ search: id ? { conversationId: id } : {} });

  /*
   * Seed the open thread's roster from the list, and let the SERVER overwrite it
   * whenever the list itself changes.
   *
   * The effect is on `conversations.data` rather than on the query, so it runs when
   * a new page object arrives and not on every render, and `setThread(found)` is
   * called with a row the list already holds rather than a copy — so the 30-second
   * poll is what keeps a thread whose membership changed on another device honest.
   * Nothing writes `thread` back into the list cache, so the two cannot ping-pong.
   */
  useEffect(() => {
    if (!conversationId) {
      setThread(null);
      return;
    }
    const found = conversations.data?.data.find((row) => row.id === conversationId);
    if (found) setThread(found);
  }, [conversationId, conversations.data]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Messages"
        description="Conversations with your teachers, students and administrators."
      />

      <div className="md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:gap-4">
        <section
          aria-label="Conversations"
          className={cn(
            'flex flex-col gap-2',
            // The list hides only on mobile, and only when a thread is open.
            conversationId ? 'hidden md:flex' : 'flex',
          )}
        >
          {conversations.isPending ? (
            <SkeletonList rows={5} />
          ) : (conversations.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              variant="empty"
              compact
              title="No conversations"
              description="Start one from a course page, or wait for a teacher to reach out."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {conversations.data?.data.map((conversation) => {
                const people = counterparts(conversation, user?.id);
                // The person the row is "about". `people` is never empty in practice —
                // see the fallback in `counterparts` — but index access is not narrowed
                // here, so the label degrades instead of rendering `undefined`.
                const lead = people[0];
                const label =
                  conversation.title ??
                  people.map((participant) => participant.user.name).join(', ');
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => open(conversation.id)}
                      aria-current={conversation.id === conversationId ? 'true' : undefined}
                      className={cn(
                        'flex tap w-full items-center gap-3 rounded-[var(--card-radius)] border p-3 text-start',
                        'transition-colors duration-[var(--duration-fast)]',
                        'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
                        conversation.id === conversationId
                          ? 'border-line-brand bg-selected'
                          : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-hover',
                      )}
                    >
                      <Avatar
                        // A participant IS NOT a person: `participantSchema` is the
                        // membership row and the person is one level down, at `.user`
                        // (conversation.ts:12-18).
                        name={lead?.user.name ?? 'Conversation'}
                        src={lead?.user.avatarUrl ?? null}
                        size="md"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {label || 'Conversation'}
                          </span>
                          <span className="shrink-0 text-2xs text-fg-tertiary">
                            {formatRelative(conversation.lastMessageAt)}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-fg-tertiary">
                            {/*
                              There is no `lastMessagePreview` on the wire. The
                              conversation ships the whole last live message
                              (conversation.ts:30), already filtered for soft deletes by
                              the server's take-1 window (conversations.service.ts:49-54),
                              so the preview is just its content.
                            */}
                            {conversation.lastMessage?.content ?? 'No messages yet'}
                          </span>
                          {conversation.unreadCount > 0 ? (
                            <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-2xs font-bold text-fg-on-brand tabular-nums">
                              {conversation.unreadCount}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {conversations.data ? (
            <Pagination
              label="Conversations pagination"
              page={conversations.data.meta.page}
              totalPages={conversations.data.meta.totalPages}
              total={conversations.data.meta.total}
              limit={conversations.data.meta.limit}
              onPageChange={setPage}
            />
          ) : null}
        </section>

        <section
          aria-label="Conversation"
          className={cn(conversationId ? 'flex flex-col' : 'hidden md:flex md:flex-col')}
        >
          {conversationId ? (
            <Thread
              conversationId={conversationId}
              conversation={thread}
              onBack={() => open(undefined)}
              onRosterChange={(updated) => {
                setThread(updated);
                /*
                 * The endpoint answers with the refreshed conversation, so the LIST
                 * row is written from the same object the header is — rather than
                 * leaving the list to redraw the membership it just changed on its
                 * next 30-second poll. It is the same `writeConversationRow` the
                 * read receipt uses, deliberately: one function, two callers, one
                 * definition of which cache entries hold a conversation page.
                 */
                writeConversationRow(queryClient, updated);
              }}
            />
          ) : (
            <EmptyState
              variant="empty"
              title="Pick a conversation"
              description="Choose a thread on the left to read it."
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The participants a thread is ABOUT, from the viewer's seat.
 *
 * conversation.ts:27 — "Null for a direct thread; the SPA renders the other participant's
 * name instead." Two facts make `participants[0]` the wrong answer to that: the creator is
 * always seated (conversations.service.ts:434-436), so the viewer is in the array and is
 * frequently first; and the array deliberately includes people who have LEFT, because
 * `participantSchema` carries `leftAt` and the thread keeps its membership history
 * (conversations.service.ts:36-39).
 *
 * So: the other, still-seated members. A thread everyone else has abandoned falls back to
 * the full roster, which names the people who were there rather than nobody at all.
 */
function counterparts(
  conversation: ConversationDto,
  viewerId: string | undefined,
): ParticipantDto[] {
  const others = conversation.participants.filter(
    (participant) => participant.user.id !== viewerId && participant.leftAt === null,
  );
  return others.length > 0 ? others : conversation.participants;
}

/**
 * How long a read receipt waits before it is sent.
 *
 * Not a debounce in the "wait for the user to stop typing" sense — the input is a
 * conversation, not a form. It exists for exactly two deliveries that mean the same
 * thing: a send whose `onSuccess` invalidates `qk.messages` (below) and the 15s poll
 * that then refetches the same window, so one arriving message can be observed
 * twice within a few hundred milliseconds. One receipt, not two, is the difference
 * between "the badge cleared" and "we asked the server the same question twice".
 *
 * Kept well under the shortest thing a reader can do deliberately next — opening
 * another thread, above all — so a real navigation is never held back by it.
 */
const READ_RECEIPT_MS = 250;

/**
 * Writes ONE conversation row back into every cached `GET /conversations` page.
 *
 * `POST /conversations/:id/read` answers with the refreshed conversation
 * (conversations.routes.ts, the `/:conversationId/read` route binds
 * `conversationSchema` as its 200) precisely so the badge and the server agree in
 * one round trip. `client.invalidateQueries({ queryKey: qk.conversations })` — what
 * the `send` mutation below uses — would throw that away and re-fetch the list, so
 * the reader watches a badge that was just cleared repopulate with the count they
 * had already dismissed.
 *
 * WHY THE PREDICATE AND NOT THE BARE PREFIX. `qk.conversations` is `['conversations']`
 * and `qk.messages(conversationId)` is `['conversations', id, 'messages']`, so
 * TanStack's prefix matching reaches the message cache as well (the same reason
 * `send`'s invalidation deliberately does — see the comment there). A conversation
 * page and a cursor page of messages are both `{ data: [...] }`; only the former
 * has `unreadCount` on its rows, and that is the discriminator. Without it, a receipt
 * would rewrite the message cache's identity on every thread focus and re-render a
 * pane that had not changed.
 */
function writeConversationRow(client: QueryClient, updated: ConversationDto): void {
  client.setQueriesData<Paginated<ConversationDto> | undefined>(
    {
      predicate: (query) =>
        query.queryKey[0] === qk.conversations[0] && isConversationPage(query.state.data),
    },
    (page) => {
      if (!page) return page;
      // A page that does not hold this row is returned BY REFERENCE, not rebuilt:
      // another conversation's page, or a page of a different filter, must not be
      // republished as a new object because an unrelated thread was read.
      if (!page.data.some((row) => row.id === updated.id)) return page;
      return { ...page, data: page.data.map((row) => (row.id === updated.id ? updated : row)) };
    },
  );
}

/** The list discriminator `writeConversationRow` relies on, kept beside its only user. */
function isConversationPage(data: unknown): data is Paginated<ConversationDto> {
  if (typeof data !== 'object' || data === null) return false;
  const rows = (data as { data?: unknown }).data;
  return (
    Array.isArray(rows) &&
    rows.every((row) => typeof row === 'object' && row !== null && 'unreadCount' in row)
  );
}

function Thread({
  conversationId,
  conversation,
  onBack,
  onRosterChange,
}: {
  conversationId: string;
  /**
   * The open thread's row from the list, or `null` when the id came from a
   * deep link and the thread is not on the page that is loaded. `null` degrades
   * the header to a generic label and hides the participant list — it never
   * claims a thread has nobody in it, which is what `?? []` would render.
   */
  conversation: ConversationDto | null;
  onBack: () => void;
  /** Writes a refreshed conversation back to the page, so the header updates. */
  onRosterChange: (conversation: ConversationDto) => void;
}) {
  const { user } = useSession();
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  /**
   * The idempotency key for the message being composed — minted once per DRAFT, not once
   * per attempt.
   *
   * message.ts:26-30: `clientMsgId` is UNIQUE per sender in the database, so re-sending
   * after a timeout returns the original message instead of posting a second copy. A key
   * minted inside `mutationFn` would be a different key on every attempt and would buy
   * nothing at all — and mutations do not auto-retry here (query.ts:32-34), so the retry
   * this protects is the human one: the user pressing send again after an error they were
   * shown. It is cleared only on success, at which point the next draft gets its own key.
   */
  const draftKey = useRef<string | null>(null);

  const messages = useQuery({
    queryKey: qk.messages(conversationId),
    queryFn: () =>
      api.get<CursorPaginated<MessageDto>>(`/conversations/${conversationId}/messages`, {
        query: { limit: 50 },
      }),
    refetchInterval: 15_000,
  });

  /**
   * History fetched by "Load older messages", kept OUTSIDE the `messages` query's
   * cache entry rather than merged into it. `send`'s `onSuccess` below invalidates
   * `qk.messages(conversationId)` on every send, which refetches this query's own
   * `queryFn` — latest 50, no cursor — and REPLACES whatever was cached. Merging
   * older pages into that same cache entry would have them vanish the next time
   * anyone in the thread sent a message.
   *
   * `null` (from `meta.nextCursor`, pagination.ts:82-83) means history is exhausted;
   * `undefined` means "not learned yet" — distinct so the button does not flash
   * before the first fetch resolves.
   */
  const [olderPages, setOlderPages] = useState<MessageDto[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);

  // `Thread` is not remounted when `conversationId` changes — there is no `key` on
  // it in the parent — so switching threads must clear the PREVIOUS thread's history
  // by hand, or the next one would open with someone else's older messages spliced in.
  useEffect(() => {
    setOlderPages([]);
    setOlderCursor(undefined);
  }, [conversationId]);

  // Learns the cursor once, from the first window this conversation loads. Guarded
  // so a later poll (`refetchInterval` above) or the send mutation's own cache write
  // cannot stomp on progress `loadOlder` has already made.
  useEffect(() => {
    if (messages.data && olderCursor === undefined) {
      setOlderCursor(messages.data.meta.nextCursor);
    }
  }, [messages.data, olderCursor]);

  const loadOlder = useMutation({
    mutationFn: () => {
      // The trigger below only renders while `olderCursor` is a real string; this
      // guard is what lets TypeScript narrow it past that point rather than a claim
      // this code cannot prove.
      if (!olderCursor) return Promise.reject(new Error('No older messages to load'));
      return api.get<CursorPaginated<MessageDto>>(`/conversations/${conversationId}/messages`, {
        query: { limit: 50, cursor: olderCursor },
      });
    },
    onSuccess: (page) => {
      setOlderPages((current) => [...current, ...page.data]);
      setOlderCursor(page.meta.nextCursor);
    },
    onError: (error) => toast.fromError(error, 'Could not load older messages'),
  });

  /**
   * Oldest first, which is not how either page arrives.
   *
   * Without `after`, the endpoint pages BACKWARDS through history — `orderBy: { seq:
   * 'desc' }` (conversations.service.ts:494-505) — so the newest message in each
   * fetched window is at index 0. Rendering as fetched puts the end of the
   * conversation at the top of a pane that then scrolls to its bottom.
   *
   * `seq` is a Postgres bigint delivered as a STRING (bigIntStringSchema, common.ts:51-53)
   * and is compared as a BigInt, never coerced to Number: past 2^53 two distinct messages
   * would round to the same value and the comparison would start tying.
   */
  const thread = useMemo(() => {
    const rows = [...olderPages, ...(messages.data?.data ?? [])];
    return [...rows].sort((a, b) => {
      if (a.seq === b.seq) return 0;
      return BigInt(a.seq) < BigInt(b.seq) ? -1 : 1;
    });
  }, [messages.data, olderPages]);

  // Keyed on the NEWEST message rather than the whole array, so loading older
  // history — which prepends to `thread` without changing its last element — does
  // not yank the view back down to the bottom right after the user asked to see
  // the past.
  const newestId = thread[thread.length - 1]?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [newestId]);

  /*
   * THE READ RECEIPT, and the two decisions this block exists to make explicit.
   *
   * WHY HERE AND NOT ON THE PAGE. `POST /conversations/:id/read` moves ONE
   * participant's high-water mark (conversations.service.ts, `markRead`). The screen
   * above lists every thread the viewer is seated in and none of them has been
   * opened; marking the list read would claim the reader has seen messages they
   * never saw, on a phone as much as on a laptop. `Thread` mounts when — and only
   * when — `conversationId` is set, which is the same condition that puts the thread
   * pane on screen above `md` and REPLACES the list below it. So this is the moment
   * the conversation is the open one, on both layouts, from one place.
   *
   * WHY THERE IS NO `onError`. The reader asked for nothing and can do nothing about
   * a receipt. `toast.fromError` — correct everywhere else in this file, and the only
   * sanctioned way to surface a failure — would put an error toast on screen for a
   * background bookkeeping write the user never initiated: alarming, unactionable,
   * and gone before it could be read. The worst outcome of a failed receipt is a
   * badge that is one conversation stale, and the list polls every 30s, so the next
   * poll reports the server's truth and the badge recovers on its own. The client-wide
   * MutationCache handler in lib/query.ts still runs, so a 401 or a suspension
   * (lesson 27) is still noticed — silence here is about THIS error, not about the
   * session.
   *
   * WHY THE SENT SEQ IS RECORDED BEFORE THE ANSWER. The guard is written down the
   * instant the receipt is issued, not in `onSuccess`. A receipt that failed and
   * stayed unrecorded would be re-sent by the very next poll — every 15 seconds, for
   * as long as the thread stays open, which is a request storm produced by the
   * recovery mechanism. A stale badge for 30s is the cheaper failure.
   */
  const markRead = useMutation({
    mutationFn: (input: MarkReadInput) =>
      api.post<ConversationDto>(`/conversations/${conversationId}/read`, input),
    onSuccess: (updated) => writeConversationRow(client, updated),
  });

  /*
   * `markRead.mutate` hoisted to a name of its own, for the dependency array.
   *
   * `useMutation` returns a NEW object literal on every render, so listing
   * `markRead` as a dependency would re-run the effect below on every render — and
   * re-running it CLEARS the pending timer and starts a fresh one. A reader who
   * types a reply for longer than the delay would keep resetting the receipt
   * without ever sending it, and a receipt is not something a reply should be able
   * to starve. `mutate` itself is a `useCallback` bound to one observer
   * (`useMutation.js` in the react-query build), so this alias is stable across
   * renders and the effect runs when its inputs actually change.
   */
  const markThreadRead = markRead.mutate;

  /*
   * Per conversation, not per Thread: `Thread` is not remounted when `conversationId`
   * changes, so a single "last seq I sent" would be overwritten by the next thread
   * and A -> B -> A would send A's receipt a second time for a thread whose newest
   * message had not moved. The map makes the guard a statement about the CONVERSATION
   * ("has this watermark already been offered at this seq?"), which is what the
   * server is actually being told.
   *
   * `BigInt`, not `Number` — `seq` is a Postgres bigint delivered as a string
   * (message.ts:22), for the reason spelled out in the `thread` comparator above.
   */
  const markedSeqs = useRef(new Map<string, string>());
  /**
   * ONE pending receipt for the whole pane, deliberately not one per conversation.
   * Flipping through five threads faster than the delay is a reader triaging, and
   * triaging is the case where a request storm is most likely and least useful: the
   * thread that is still open at the deadline is the one worth a receipt. So a new
   * schedule REPLACES the pending one rather than adding to it.
   *
   * There is no cleanup that cancels it. A reader who backs out of a thread inside
   * the delay still read it, and the request client outlives this component, so the
   * receipt is still worth sending; cancelling on unmount would trade a badge for a
   * lifecycle rule nobody asked for.
   */
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The newest seq in the LOADED window — the same `thread` the reader is looking
  // at, so the receipt can never claim more than what is on screen. `loadOlder`
  // prepends to `thread` without touching its last element, and this is keyed on
  // that last element, so scrolling back through history sends nothing.
  const newestSeq = thread[thread.length - 1]?.seq;
  useEffect(() => {
    if (newestSeq === undefined) return;
    const offered = markedSeqs.current.get(conversationId);
    if (offered !== undefined && BigInt(offered) >= BigInt(newestSeq)) return;

    if (readTimer.current !== null) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      readTimer.current = null;
      // Re-read under the timer: renders between scheduling and firing can have
      // offered a HIGHER seq already, and a slower one must not be sent.
      const latest = markedSeqs.current.get(conversationId);
      if (latest !== undefined && BigInt(latest) >= BigInt(newestSeq)) return;
      markedSeqs.current.set(conversationId, newestSeq);
      markThreadRead({ seq: newestSeq });
    }, READ_RECEIPT_MS);
  }, [conversationId, newestSeq, markThreadRead]);

  const send = useMutation({
    // `SendMessageInput` is the server's own body type (message.ts:31-38), so a missing or
    // misspelled field here is a compile error rather than a 422 discovered by a user.
    mutationFn: (input: SendMessageInput) =>
      api.post<MessageDto>(`/conversations/${conversationId}/messages`, input),
    onSuccess: async (message) => {
      draftKey.current = null;
      setDraft('');
      /*
       * Reconcile on the ECHOED `clientMsgId` (message.ts:18-19), never on content: two
       * identical lines are an ordinary thing to send, and a replayed send returns the
       * ORIGINAL message — same key, same id — which must land in the thread exactly once.
       * Seeding the cache here is what makes the sent line appear immediately instead of
       * one refetch later.
       */
      client.setQueryData<CursorPaginated<MessageDto>>(qk.messages(conversationId), (current) => {
        if (current === undefined) return current;
        if (current.data.some((row) => row.clientMsgId === message.clientMsgId)) return current;
        return { ...current, data: [...current.data, message] };
      });
      await client.invalidateQueries({ queryKey: qk.messages(conversationId) });
      // The list row renders `lastMessage` and the unread badge, and sending moved both
      // (the server advances the sender's own high-water mark, service:596-604).
      await client.invalidateQueries({ queryKey: qk.conversations });
    },
    // The draft and its key survive an error on purpose: pressing send again reuses the
    // key, so an attempt that actually reached the server cannot post a second copy.
    onError: (error) => toast.fromError(error, 'Message not sent'),
  });

  const submit = () => {
    const content = draft.trim();
    if (content.length === 0 || send.isPending) return;
    // `ulid()`, not a home-rolled string. `sendMessageSchema` requires
    // /^[0-9A-HJKMNP-TV-Z]{26}$/ (message.ts:33-36) — 26 uppercase Crockford characters —
    // and the ~16 lowercase base36 characters this used to mint were a 422 on every send.
    const clientMsgId = draftKey.current ?? ulid();
    draftKey.current = clientMsgId;
    send.mutate({ content, clientMsgId });
  };

  /*
   * `conversation:join` is SUBJECT-INDEPENDENT — anonymous deny, STUDENT deny,
   * TEACHER deny, ADMIN allow, every cell a terminal rule reading no Subject field
   * ("Self-joining an arbitrary thread is the whole attack. Only an admin adds a
   * participant, and only to a thread that already exists"). So a bare `can()` with
   * no subject is not a shortcut here, it is the complete gate, and passing one
   * would only invent a way for the two to disagree.
   *
   * It is asked on the PAGE rather than passed in, because the page is where
   * `useSession` already lives and the action does not depend on which thread is
   * open — an admin may seat somebody into a thread they are not themselves seated
   * in, which is exactly what the service's `lastMessage: null` branch above is
   * written for.
   */
  const canAddParticipant = useCan('conversation:join');
  const [adding, setAdding] = useState(false);

  /*
   * The header names the thread. It used to say the literal word "Conversation"
   * on every thread, which is the one piece of information a messaging screen has
   * no other way to give: the list row is above it on a desktop and BEHIND it on
   * a phone, so below `md` the person reading the messages had nothing but a
   * back arrow telling them whose they were. The label is the same one the list
   * builds — a title, else the seated counterparts' names joined — so the two
   * cannot disagree about what a thread is called.
   */
  const label = conversation
    ? (conversation.title ??
      counterparts(conversation, user?.id)
        .map((participant) => participant.user.name)
        .join(', '))
    : '';

  return (
    <div className="flex flex-col rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-line-subtle p-2">
        <IconButton
          aria-label="Back to conversations"
          icon={<ArrowLeft className="size-5" />}
          onClick={onBack}
          className="md:hidden"
        />
        {/*
          The label is a BUTTON for an admin and plain text for everybody else, from
          one piece of state: the dialog is the only thing behind it, and a control
          that does nothing for the nine people out of ten who cannot use it is the
          affordance-that-lies this repository keeps finding. The two are also
          distinguishable to a screen reader — a button announces as a button, which
          is what "you can add somebody here" means.
        */}
        {canAddParticipant ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(true)}
            className="min-w-0 flex-1 justify-start px-1"
            aria-label={`Add someone to ${label || 'this conversation'}`}
          >
            <UserRoundPlus aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{label || 'Conversation'}</span>
          </Button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {label || 'Conversation'}
          </span>
        )}
      </div>

      {/*
        Mounted whenever the trigger has been used, and with an EMPTY roster when
        the thread is not on the list page that is loaded. The dialog still works
        in that state: it names who is already in the thread by excluding them from
        the candidates, and an unknown roster means nobody is excluded — while the
        endpoint is an UPSERT that re-seats somebody who has left. Gating the
        dialog on the roster instead would have made the trigger open nothing at
        all for a deep link, which is the affordance-that-lies problem one level
        worse.
      */}
      {adding ? (
        <AddParticipantDialog
          conversationId={conversationId}
          participants={conversation?.participants ?? []}
          open={adding}
          onOpenChange={setAdding}
          onUpdated={onRosterChange}
        />
      ) : null}

      <div className="scroll-y flex flex-col gap-2 p-3 [block-size:55dvh] md:[block-size:60dvh]">
        {messages.isPending ? (
          <SkeletonThread />
        ) : thread.length === 0 ? (
          <EmptyState
            variant="empty"
            compact
            title="No messages yet"
            description="Say something to get this started."
          />
        ) : (
          <>
            {olderCursor ? (
              <Button
                variant="ghost"
                size="sm"
                loading={loadOlder.isPending}
                onClick={() => loadOlder.mutate()}
                className="mx-auto"
              >
                Load older messages
              </Button>
            ) : null}
            {thread.map((message) => {
              // `messageSchema` has no `senderId` and no `senderName`; it nests the person
              // as `sender: UserSummary` (message.ts:14). Reading the flat names left `mine`
              // false for every row, so the whole thread rendered as somebody else's.
              const mine = message.sender.id === user?.id;
              return (
                <div
                  key={message.id}
                  className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'w-[min(85%,32rem)] rounded-xl px-3 py-2 text-sm',
                      mine
                        ? 'rounded-br-sm bg-brand text-fg-on-brand'
                        : 'rounded-bl-sm bg-sunken text-fg',
                    )}
                  >
                    {!mine ? (
                      <span className="mb-0.5 block text-2xs font-semibold text-fg-tertiary">
                        {message.sender.name}
                      </span>
                    ) : null}
                    <p className="break-words whitespace-pre-wrap">{message.content}</p>
                  </div>
                  <span className="px-1 text-2xs text-fg-tertiary">
                    {formatTime(message.createdAt)}
                  </span>
                </div>
              );
            })}
          </>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line-subtle p-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoResize
          rows={1}
          aria-label="Message"
          placeholder="Write a message"
          className="[max-block-size:8rem]"
          onKeyDown={(event) => {
            // Enter sends on a pointer device; Shift+Enter is a newline. On a
            // touch keyboard Enter is always a newline, because there is no
            // Shift to hold and losing a half-written message is unforgivable.
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              window.matchMedia('(pointer: fine)').matches
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="submit"
          size="md"
          aria-label="Send message"
          loading={send.isPending}
          disabled={draft.trim().length === 0}
          className="shrink-0"
        >
          <SendHorizonal aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
    </div>
  );
}
