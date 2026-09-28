import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { useSession } from '@/lib/session';
import type { ConversationDto, UserSummary } from '@/lib/types';
import { Gate } from '@/components/Gate';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * Start (or rejoin) the direct thread with this course's teacher, and open it.
 *
 * WHY THE API CAN DO "FIND OR CREATE" AND THE CLIENT DOES NOT HAVE TO GUESS.
 * `create()` in conversations.service.ts:431-472 is explicitly find-or-create for
 * a DIRECT thread: with no `title` and exactly two participants it calls
 * `findDirectConversation` first and returns that conversation rather than seating
 * a second one, and two racing creates converge on the oldest. So one POST is the
 * whole operation — there is no lookup-then-create race for this screen to lose,
 * and the dedup comment in the schema ("deduplicated server-side rather than by
 * the client remembering the id") names this call site as the intended one.
 *
 * WHAT THE CLIENT MUST NOT SEND, and why the omission is load-bearing: `title`.
 * The dedup branch is gated on `input.title === undefined`, so a titled request
 * skips `findDirectConversation` and creates a NEW conversation every time. The
 * same branch is also why no opening `message` is sent — `createConversationSchema`
 * mints its own idempotency key per call, so a retried create with a message would
 * post a second opening line into the thread it just found.
 *
 * THE TEACHER GETS NO BUTTON ON THEIR OWN COURSE, and that is a data check rather
 * than a permission one. `conversation:create` is a bare allow for all three signed-in
 * roles (`POLICY`), so the policy cannot keep a teacher out of it — and a
 * teacher naming themself in `participantIds` produces a one-participant set, which
 * is not the two-person shape the dedup branch requires, so the server would
 * cheerfully seat a thread with a single member in it on every click.
 *
 * THE FULL NAME IS IN THE LABEL, and there is no first-name shortening. The obvious
 * `split(' ')[0]` is a guess about name order dressed as a label, and it is wrong in
 * both directions: it turned this repository's own "Person 1" into "Message Person",
 * and it would turn "Della Mae" into a button naming a person who does not exist. A
 * `PageHeader` action bar wraps; a mislabelled button is a support ticket. Caught by
 * `e2e/course-actions.spec.ts`, which drives the real bundle and is the only test
 * here that can see what the label actually reads.
 */
export function MessageTeacherButton({ teacher }: { teacher: UserSummary }) {
  const { user } = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();

  const start = useMutation({
    mutationFn: () => api.post<ConversationDto>('/conversations', { participantIds: [teacher.id] }),
    onSuccess: async (conversation) => {
      // The Messages list is cached under one key; without this the thread they
      // have just been sent to is missing from the pane they land in.
      await client.invalidateQueries({ queryKey: qk.conversations });
      await navigate({ to: '/messages', search: { conversationId: conversation.id } });
    },
    onError: (error) => toast.fromError(error, 'Could not open that conversation'),
  });

  if (user === null || user.id === teacher.id) return null;

  return (
    /*
     * A BARE `Gate`, with no subject, and it is the documented exception rather than
     * a repetition of LESSONS-LEARNED #15: every cell of `conversation:create` is a
     * terminal allow that reads no `Subject` field, which is exactly the case that
     * file names as the only correct use of a subject-free `can()`. A subject here
     * would be invented rather than loaded, and `Gate` would then be asking a
     * question nobody on this page can answer.
     */
    <Gate action="conversation:create">
      <Button
        variant="secondary"
        block
        className="sm:w-auto"
        loading={start.isPending}
        leadingIcon={<MessageCircle aria-hidden="true" className="size-4" />}
        onClick={() => start.mutate()}
      >
        Message {teacher.name}
      </Button>
    </Gate>
  );
}
