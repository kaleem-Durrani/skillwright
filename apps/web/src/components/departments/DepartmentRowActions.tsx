import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolicy } from '@/lib/policy';
import { ApiError, isDemoDenial } from '@/lib/problem';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/Toast';

export interface DepartmentRowActionsProps {
  department: {
    id: string;
    name: string;
  };
  /** Opens the shared DepartmentFormDialog in edit mode; owned by the caller. */
  onEdit: () => void;
}

/**
 * The per-row menu for a department, and the one place its DELETE lives.
 *
 * Every `department:*` action is role-only (ADMIN allow, TEACHER and STUDENT deny),
 * so a teacher or student gets NO menu at all here — the same "an empty menu is
 * worse than none" rule AdminUsers' row menu follows. The actions are also all
 * subject-independent, so these `can()` calls carry no subject: passing one would
 * change nothing, because no rule in this family reads a Subject field.
 *
 * TWO refusals render as sentences rather than errors:
 *
 * - A DEMO-provenance session is denied deletes by policy (`provenance:DEMO`,
 *   docs/permissions.md department:delete) — calm copy inside the dialog.
 * - Deleting a department that still has courses or members answers 409
 *   (departments.service.ts:198-205). That lands INLINE in the dialog as honest
 *   copy about what still points at it, not as a toast that has already vanished.
 */
export function DepartmentRowActions({ department, onEdit }: DepartmentRowActionsProps) {
  const policy = usePolicy();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  /** Set when the delete came back 409 — the dialog then explains instead of closing. */
  const [conflict, setConflict] = useState<string | null>(null);

  // No subject argument, deliberately: every rule behind these actions is a bare
  // role allow/deny (policy.ts:354-402), so the answer cannot depend on one.
  const canUpdate = policy.can('department:update');
  const deleteDecision = policy.check('department:delete');
  const showDelete = deleteDecision.allowed || deleteDecision.rule === 'provenance:DEMO';

  const remove = useMutation({
    mutationFn: () => api.del<void>(`/departments/${department.id}`),
    onSuccess: async () => {
      setConfirming(false);
      setConflict(null);
      toast.success('Department deleted', {
        description: 'It has been removed from every list. This cannot be undone from the app.',
      });
      await client.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error) => {
      if (isDemoDenial(error)) {
        toast.info('Disabled in the demo environment', {
          description: 'Deleting departments is turned off for demo accounts.',
        });
        return;
      }
      /*
       * The one CONFLICT this endpoint can answer with: courses or people still
       * attached (departments.service.ts:198-205). Shown INSIDE the dialog, where
       * the decision was made, instead of as a toast that outlives nothing.
       */
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setConflict(
          'This department still has courses or members. Move them to another department before deleting it.',
        );
        return;
      }
      toast.fromError(error, 'Could not delete that department');
    },
  });

  if (!canUpdate && !showDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={`Actions for ${department.name}`}
            icon={<MoreVertical className="size-5" />}
            size="sm"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUpdate ? (
            <DropdownMenuItem icon={<Pencil className="size-4" />} onSelect={onEdit}>
              Edit department
            </DropdownMenuItem>
          ) : null}
          {showDelete ? (
            <DropdownMenuItem
              destructive
              icon={<Trash2 className="size-4" />}
              onSelect={() => {
                setConflict(null);
                setConfirming(true);
              }}
            >
              Delete department
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete this department?"
          description={`${department.name} will disappear from registration forms and course pages immediately.`}
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
                Delete department
              </Button>
            </>
          }
        >
          {!deleteDecision.allowed && deleteDecision.rule === 'provenance:DEMO' ? (
            <p className="text-fg-secondary">
              Disabled in the demo environment. Demo accounts cannot delete departments, so nothing
              here can be removed even by an administrator. Everything else — editing, adding —
              works.
            </p>
          ) : (
            <>
              {/*
                Rendered as a status region so a screen reader announces the refusal;
                the confirm button stays enabled for the retry after the user fixes
                the cause elsewhere.
              */}
              {conflict ? (
                <p role="status" className="mb-3 text-sm font-medium text-danger-fg">
                  {conflict}
                </p>
              ) : null}
              <p className="text-fg-secondary">
                Departments with courses, teachers or students attached cannot be deleted. This
                action is written to the audit log with your name against it.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
