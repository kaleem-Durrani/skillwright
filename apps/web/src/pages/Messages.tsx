import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SendHorizonal } from 'lucide-react';
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
import type { CursorPaginated, Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { formatRelative, formatTime } from '@/lib/format';
import type { ConversationDto, MessageDto, ParticipantDto, SendMessageInput } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
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
    queryKey: qk.conversations,
    queryFn: () => api.get<Paginated<ConversationDto>>('/conversations'),
    refetchInterval: 30_000,
  });

  const open = (id: string | undefined) =>
    void navigate({ search: id ? { conversationId: id } : {} });

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
                        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus',
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
        </section>

        <section
          aria-label="Conversation"
          className={cn(conversationId ? 'flex flex-col' : 'hidden md:flex md:flex-col')}
        >
          {conversationId ? (
            <Thread conversationId={conversationId} onBack={() => open(undefined)} />
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

function Thread({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
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
   * Oldest first, which is not how the page arrives.
   *
   * Without `after`, the endpoint pages BACKWARDS through history — `orderBy: { seq:
   * 'desc' }` (conversations.service.ts:494-505) — so the newest message is at index 0.
   * Rendering the array as it comes puts the end of the conversation at the top of a pane
   * that then scrolls to its bottom.
   *
   * `seq` is a Postgres bigint delivered as a STRING (bigIntStringSchema, common.ts:51-53)
   * and is compared as a BigInt, never coerced to Number: past 2^53 two distinct messages
   * would round to the same value and the comparison would start tying.
   */
  const thread = useMemo(() => {
    const rows = messages.data?.data ?? [];
    return [...rows].sort((a, b) => {
      if (a.seq === b.seq) return 0;
      return BigInt(a.seq) < BigInt(b.seq) ? -1 : 1;
    });
  }, [messages.data]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread]);

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

  return (
    <div className="flex flex-col rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-line-subtle p-2">
        <IconButton
          aria-label="Back to conversations"
          icon={<ArrowLeft className="size-5" />}
          onClick={onBack}
          className="md:hidden"
        />
        <span className="truncate text-sm font-semibold">Conversation</span>
      </div>

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
          thread.map((message) => {
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
          })
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
