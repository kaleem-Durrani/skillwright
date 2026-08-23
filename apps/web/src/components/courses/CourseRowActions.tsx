import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { subject, usePolicy } from '@/lib/policy';
import { isDemoDenial } from '@/lib/problem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/Toast';

export interface CourseRowActionsProps {
  course: {
    id: string;
    name: string;
    teacherId: string;
  };
  /** Opens the shared CourseFormDialog in edit mode; owned by the caller. */
  onEdit: () => void;
}

/**
 * The per-row menu for a course, and the one place its DELETE lives.
 *
 * Every item is gated through `can()` WITH the subject `ownsCourse` reads —
 * `{ courseTeacherId }`, named field by named field (LESSONS-LEARNED #18). A
 * teacher who does not own the course sees no menu at all, exactly as policy
 * decides it.
 *
 * The DEMO environment denies deletes on purpose (`provenance:DEMO` rule tag,
 * docs/permissions.md course:delete). The refusal is rendered as a sentence in
 * the dialog — "Disabled in the demo environment" — rather than an error-shaped
 * dead end, because the flagship demo must read as designed rather than broken.
 */
export function CourseRowActions({ course, onEdit }: CourseRowActionsProps) {
  const policy = usePolicy();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const target = subject({ id: course.id, courseTeacherId: course.teacherId });

  const canUpdate = policy.can('course:update', target);
  const deleteDecision = policy.check('course:delete', target);
  // Allowed outright (an admin, or the owning teacher outside the demo), OR denied
  // ONLY by the demo provenance — that second case still shows the item so the
  // dialog can explain why, instead of the capability silently vanishing.
  const showDelete = deleteDecision.allowed || deleteDecision.rule === 'provenance:DEMO';

  const remove = useMutation({
    mutationFn: () => api.del<void>(`/courses/${course.id}`),
    onSuccess: async () => {
      setConfirming(false);
      toast.success('Course deleted', {
        description: 'It has been removed from every list. This cannot be undone from the app.',
      });
      await client.invalidateQueries({ queryKey: ['courses'] });
    },
    onError: (error) => {
      if (isDemoDenial(error)) {
        // Defensive second line: the dialog already disables this path when the
        // client-side check says DEMO; this catches a stale cached actor.
        toast.info('Disabled in the demo environment', {
          description: 'Deleting courses is turned off for demo accounts.',
        });
        return;
      }
      toast.fromError(error, 'Could not delete that course');
    },
  });

  if (!canUpdate && !showDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={`Actions for ${course.name}`}
            icon={<MoreVertical className="size-5" />}
            size="sm"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUpdate ? (
            <DropdownMenuItem icon={<Pencil className="size-4" />} onSelect={onEdit}>
              Edit course
            </DropdownMenuItem>
          ) : null}
          {showDelete ? (
            <DropdownMenuItem
              destructive
              icon={<Trash2 className="size-4" />}
              onSelect={() => setConfirming(true)}
            >
              Delete course
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete this course?"
          description={`${course.name} will disappear from every list immediately.`}
          footer={
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                loading={remove.isPending}
                disabled={!deleteDecision.allowed}
                onClick={() => remove.mutate()}
              >
                Delete course
              </Button>
            </>
          }
        >
          {!deleteDecision.allowed && deleteDecision.rule === 'provenance:DEMO' ? (
            /*
              The honest sentence, not an error shape: demo accounts share one dataset
              on a reset schedule, so deleting is refused by design — the refusal is a
              property of the environment, not a failure of the user's action.
            */
            <p className="text-fg-secondary">
              Disabled in the demo environment. Demo accounts cannot delete courses, so nothing here
              can be removed even by an administrator. Everything else — editing, publishing —
              works.
            </p>
          ) : (
            <p className="text-fg-secondary">
              Enrolments keep their records, but the course can only be brought back by an
              administrator working directly on the data. The action is written to the audit log
              with your name against it.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
