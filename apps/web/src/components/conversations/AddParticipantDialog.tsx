import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { UserRoundPlus } from 'lucide-react';
import { MAX_PAGE_SIZE } from '@skillwright/shared/schema';
import { api, type Paginated } from '@/lib/api';
import { qk } from '@/lib/query';
import type { ConversationDto, UserDetail } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';

/**
 * `POST /conversations/:conversationId/participants` — seating a third person in a
 * thread that already has two.
 *
 * The endpoint existed with a gate and no caller, so a direct thread could only
 * ever be a direct thread: `conversation.ts` declares "N participants, not a
 * (teacher, student) pair", and the only way the SPA could ever build one was for
 * the two people to be named in the `createConversationSchema.participantIds` list
 * at creation — which meant nobody could be added to a thread that already existed.
 *
 * The gate is `conversation:join`, which is a bare `allow`/`deny` for all four
 * cells with no subject anywhere in the rules ("Self-joining an arbitrary thread is
 * the whole attack. Only an admin adds a participant"). So the affordance is gated
 * with a bare `can('conversation:join')` in the page that owns the trigger, which is
 * one of the few actions where a subject-free check IS correct — a rule that reads
 * an absent field must deny, and this one reads none.
 */
export interface AddParticipantDialogProps {
  conversationId: string;
  /**
   * Who is already seated, INCLUDING the people who have left.
   *
   * The whole set, not the active one, and that is not a detail. `addParticipant`
   * is an UPSERT (conversations.service.ts): re-adding somebody who left CLEARS
   * their `leftAt` and puts them back in the thread. The list therefore has to be
   * able to show them — filtered out, they would be invisible and un-restorable
   * from the SPA, which is the same "the affordance is not there" gap this
   * dialog exists to close, one level down.
   */
  participants: ConversationDto['participants'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The refreshed conversation, from the endpoint's own 200 body.
   *
   * It is handed back rather than refetched because the response IS the answer to
   * the question the list row is asking, and it is deliberately WIDER than what an
   * admin who is not seated is entitled to see: the service nulls `lastMessage`
   * when the admin is not a participant (same file). Writing that row into the
   * conversation cache for an admin who is NOT in the thread would therefore cache
   * a roster the admin cannot read messages in — so the caller decides, and this
   * component says nothing about visibility.
   */
  onUpdated: (conversation: ConversationDto) => void;
}

/** How long the box must be still before a keystroke becomes a request. */
const SEARCH_DEBOUNCE_MS = 250;

export function AddParticipantDialog({
  conversationId,
  participants,
  open,
  onOpenChange,
  onUpdated,
}: AddParticipantDialogProps) {
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<UserDetail | null>(null);

  /*
   * THE DEBOUNCE, and it is a state rather than a library because the alternative
   * is a request per keystroke. `GET /users?q=` is a `LIKE` over a table of people,
   * it is not rate-limited separately from the rest of `/users`, and typing a name
   * into a phone keyboard is ten keystrokes before the first letter is a surname.
   *
   * `placeholderData: (previous) => previous` below is the other half and it is
   * what makes the wait legible: the previous result set stays on screen while the
   * next one is in flight, so the list does not collapse to a skeleton and back
   * once per character.
   */
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  /*
   * Reset on close rather than on unmount, because the dialog is MOUNTED ONCE and
   * toggled: a search term and a half-made choice left behind would be the state
   * the next admin opening it found, and "Add someone" would open showing the
   * previous person's name already selected.
   */
  useEffect(() => {
    if (!open) {
      setTerm('');
      setChosen(null);
    }
  }, [open]);

  const seated = useMemo(
    () => new Set(participants.map((participant) => participant.user.id)),
    [participants],
  );

  /*
   * `GET /users` is `user:list` — a bare allow/deny for every role, ADMIN only —
   * which is exactly the population this dialog can seat and the only one the API
   * will name. There is no "search people I can message" endpoint, and inventing
   * one would mean a new action, its matrix rows including the denials, and a
   * regenerated `docs/permissions.md`; the directory an admin already administers
   * is the right list to offer and is a list they are already entitled to.
   *
   * `enabled` is the term being non-empty, so an untouched box costs no request
   * and the dialog opens to a prompt rather than to the whole school.
   */
  const candidates = useQuery({
    queryKey: qk.users({ q: search, limit: MAX_PAGE_SIZE }),
    queryFn: () =>
      api.get<Paginated<UserDetail>>('/users', { query: { q: search, limit: MAX_PAGE_SIZE } }),
    enabled: open && search.length > 0,
    placeholderData: (previous) => previous,
  });

  const add = useMutation({
    mutationFn: (userId: string) =>
      api.post<ConversationDto>(`/conversations/${conversationId}/participants`, { userId }),
    onSuccess: (updated) => {
      onUpdated(updated);
      setChosen(null);
      setTerm('');
      onOpenChange(false);
      toast.success('Added to the conversation');
    },
    onError: (error) => toast.fromError(error, 'Could not add them to the conversation'),
  });

  const rows = candidates.data?.data ?? [];
  const available = rows.filter((row) => !seated.has(row.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add someone to this conversation"
        description="They will be able to read everything already in the thread, and to reply to it."
        footer={
          <>
            <Button variant="ghost" block className="sm:w-auto" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              block
              className="sm:w-auto"
              loading={add.isPending}
              disabled={chosen === null}
              onClick={() => chosen && add.mutate(chosen.id)}
            >
              <UserRoundPlus aria-hidden="true" className="size-4" />
              Add to conversation
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              // A new search invalidates the previous choice: leaving "Ada" selected
              // while the box says "Grace" is how the wrong person gets seated.
              setChosen(null);
            }}
            placeholder="Search by name or email"
            aria-label="Search for a person"
            autoComplete="off"
          />

          {chosen ? (
            <div className="flex items-center gap-3 rounded-[var(--control-radius)] border border-line-brand bg-selected p-2">
              <Avatar name={chosen.name} src={chosen.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{chosen.name}</span>
              <span className="truncate text-xs text-fg-tertiary">{chosen.email}</span>
            </div>
          ) : null}

          {term.trim().length === 0 ? (
            <p className="text-sm text-fg-secondary">
              {participants.length === 1
                ? 'This thread has one person in it. Search for someone to add.'
                : `${participants.length} people are already in this thread.`}
            </p>
          ) : candidates.isPending ? (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton shape="text" className="h-11 w-full" />
              <Skeleton shape="text" className="h-11 w-full" />
            </div>
          ) : available.length === 0 ? (
            <EmptyState
              variant="no-results"
              compact
              description={
                rows.length > 0
                  ? 'Everyone matching that is already in this thread.'
                  : 'Nobody matched that search.'
              }
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {available.map((row) => (
                <li key={row.id}>
                  {/*
                    A BUTTON and not a row inside a `<label>` or a `Select`. The
                    mobile-first floor is 44px on the control's own box here, with no
                    label or pseudo-element to union it with (mobile-shell.spec.ts
                    measures both), so `tap` — the 56px row the shared list components
                    use — is what makes this list pass on a phone rather than a
                    hand-written `min-h-11` that the next restyle would remove.
                  */}
                  <button
                    type="button"
                    onClick={() => setChosen(row)}
                    className="tap flex w-full items-center gap-3 rounded-[var(--control-radius)] border border-line-subtle p-2 text-start hover:bg-hover focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
                  >
                    <Avatar name={row.name} src={row.avatarUrl} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{row.name}</span>
                      <span className="truncate text-xs text-fg-tertiary">{row.email}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/*
            The confirm button is DISABLED rather than absent when nobody is chosen,
            and the reason is the destructive direction: a mis-tap that seats the
            wrong person in a thread is a data change with no undo anywhere in this
            app. There is no leave route and no remove route — `leftAt` is written in
            exactly one place in the whole API and that place writes `null` — and
            conversations.service.ts's design note beside `addParticipant` is where
            that is argued rather than left as folklore. The only recovery from a
            mis-seat today is another admin action, and none exists.

            A dialog that cannot be completed by accident is the whole value of
            putting this behind a two-step pick-then-confirm instead of seating on
            the first tap. Note what this is NOT: a mitigation for the missing leave
            route. It is a mitigation for a missing guard on the ADD path, and the
            leave route would not have supplied that guard either.
          */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
