import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SendHorizonal } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { cn } from '@/lib/cn';
import { usePolicy } from '@/lib/policy';
import { useSession } from '@/lib/session';
import { formatRelative, formatTime } from '@/lib/format';
import type { ConversationSummary, MessageRecord } from '@/lib/types';
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
  const policy = usePolicy();

  const conversations = useQuery({
    queryKey: qk.conversations,
    queryFn: () => api.get<{ data: ConversationSummary[] }>('/conversations'),
    enabled: policy.can('conversation:read'),
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
              {conversations.data?.data.map((conversation) => (
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
                      name={conversation.participants[0]?.name ?? 'Conversation'}
                      src={conversation.participants[0]?.avatarUrl ?? null}
                      size="md"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {conversation.title ??
                            conversation.participants.map((p) => p.name).join(', ')}
                        </span>
                        <span className="shrink-0 text-2xs text-fg-tertiary">
                          {formatRelative(conversation.lastMessageAt)}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-fg-tertiary">
                          {conversation.lastMessagePreview ?? 'No messages yet'}
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
              ))}
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

function Thread({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const { user } = useSession();
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: qk.messages(conversationId),
    queryFn: () =>
      api.get<{ data: MessageRecord[] }>(`/conversations/${conversationId}/messages`, {
        query: { limit: 50 },
      }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.data]);

  const send = useMutation({
    mutationFn: (content: string) =>
      api.post<MessageRecord>(`/conversations/${conversationId}/messages`, {
        content,
        // ULID-ish idempotency key: a retry after a timeout must not double-post.
        clientMsgId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      }),
    onSuccess: async () => {
      setDraft('');
      await client.invalidateQueries({ queryKey: qk.messages(conversationId) });
    },
    onError: (error) => toast.fromError(error, 'Message not sent'),
  });

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
        ) : (messages.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            variant="empty"
            compact
            title="No messages yet"
            description="Say something to get this started."
          />
        ) : (
          messages.data?.data.map((message) => {
            const mine = message.senderId === user?.id;
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
                      {message.senderName}
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
          const content = draft.trim();
          if (content) send.mutate(content);
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
              const content = draft.trim();
              if (content) send.mutate(content);
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
