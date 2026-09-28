import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssignmentDto, AssignmentSubmissionRow } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { describeUpload } from './SubmissionDialog';

export interface SubmissionsPanelProps {
  assignment: AssignmentDto;
}

/**
 * The whole class for ONE task, and the grading dialog.
 *
 * The list is fetched only when the teacher expands it, and that is the same
 * information the per-intake list already has: a teacher with thirty students and
 * three tasks has ninety possible rows, and fetching all of them to render a list of
 * three titles is ninety rows nobody asked for. `enabled` is therefore the expansion,
 * which is a fact about the UI and not a permission — the route's own gate is
 * `submission:read` with the assignment's subject, where a student's own cell reads an
 * absent `studentId` and refuses.
 */
export function SubmissionsPanel({ assignment }: SubmissionsPanelProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [grading, setGrading] = useState<AssignmentSubmissionRow | null>(null);
  const client = useQueryClient();

  const submissions = useQuery({
    queryKey: qk.assignmentSubmissions(assignment.id),
    queryFn: () =>
      api.get<{ data: AssignmentSubmissionRow[] }>(`/assignments/${assignment.id}/submissions`),
    enabled: expanded,
  });

  const refresh = async (): Promise<void> => {
    await Promise.all([
      client.invalidateQueries({ queryKey: qk.assignmentSubmissions(assignment.id) }),
      // The student's own list carries the mark, so it has to be swept too — the
      // prefix is the one relationship between the two that neither knows about.
      client.invalidateQueries({ queryKey: ['assignments'] }),
    ]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? 'Hide hand-ins'
            : `Show hand-ins${submissions.data ? ` (${submissions.data.data.length})` : ''}`}
        </Button>
      </div>

      {expanded ? (
        submissions.isPending ? (
          <SkeletonList rows={3} />
        ) : (
          <DataTable
            items={submissions.data?.data ?? []}
            caption={`Hand-ins for ${assignment.title}`}
            getKey={(row) => row.id}
            columns={[
              {
                id: 'student',
                header: 'Student',
                cell: (row) => (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.student.name} src={row.student.avatarUrl} size="sm" />
                    <span className="truncate font-medium text-fg">{row.student.name}</span>
                  </div>
                ),
              },
              {
                id: 'attempt',
                header: 'Attempt',
                cell: (row) => (row.attempt > 1 ? `#${row.attempt}` : '1st'),
                secondary: true,
              },
              {
                id: 'handed',
                header: 'Handed in',
                cell: (row) => formatRelative(row.submittedAt),
                secondary: true,
              },
              {
                id: 'mark',
                header: 'Mark',
                align: 'end',
                /*
                 * Null, never 0. "0 / 100" is a mark somebody gave, and a returned or
                 * ungraded hand-in has had none — the distinction the whole
                 * `scorePercent: number | null` contract on the student side exists to
                 * carry.
                 */
                cell: (row) =>
                  row.score === null ? (
                    <span className="text-fg-tertiary">—</span>
                  ) : (
                    <span className="font-medium text-fg">
                      {row.score} / {assignment.maxScore}
                    </span>
                  ),
              },
              { id: 'status', header: 'Status', cell: (row) => <StatusChip status={row.status} /> },
            ]}
            actions={(row) => (
              <Button size="sm" variant="secondary" onClick={() => setGrading(row)}>
                {row.status === 'GRADED' ? 'Re-mark' : 'Mark'}
              </Button>
            )}
            renderCard={(row) => (
              <Card className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <Avatar name={row.student.name} src={row.student.avatarUrl} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <CardTitle className="text-sm">{row.student.name}</CardTitle>
                    <span className="truncate text-2xs text-fg-tertiary">
                      Attempt {row.attempt} · {formatRelative(row.submittedAt)}
                    </span>
                  </div>
                  <StatusChip status={row.status} />
                </div>
                <p className="text-2xs text-fg-tertiary break-all">{describeUpload(row.upload)}</p>
                {row.feedback ? <p className="text-xs text-fg-secondary">{row.feedback}</p> : null}
                <Button
                  block
                  variant="secondary"
                  onClick={() => setGrading(row)}
                  className="self-start"
                >
                  {row.status === 'GRADED' ? 'Re-mark' : 'Mark'}
                </Button>
              </Card>
            )}
            empty={
              <EmptyState
                variant="empty"
                title="Nobody has handed in yet"
                description="Hand-ins appear here the moment a seated student sends one."
              />
            }
          />
        )
      ) : null}

      {/*
        Remounted per hand-in by `key`, and that is load-bearing rather than tidy: the
        mark and feedback boxes are `useState`, so a dialog seeded once at mount would
        open on the SECOND student still holding the FIRST one's 62. The cost is the
        close animation, which this file already traded away on `CourseDetail.tsx`'s
        two dialogs for the same reason.
      */}
      <GradeDialog
        key={grading?.id ?? 'none'}
        submission={grading}
        maxScore={assignment.maxScore}
        onClose={() => setGrading(null)}
        onSaved={refresh}
      />
    </div>
  );
}

interface GradeDialogProps {
  submission: AssignmentSubmissionRow | null;
  maxScore: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

/**
 * Two outcomes, one dialog, and the switch between them is explicit.
 *
 * Marking and returning are separate URLs carrying one policy action
 * (`submission:grade`), on the rule `enrollment:withdraw` states verbatim: a status
 * column written by two different URLs carries one audit action, so the trail could
 * not distinguish "I marked this" from "I sent this back". The return is therefore not
 * "grade with an empty score" here either — it is a different button, and the body it
 * sends cannot carry a mark, so a client that is wrong about which one it is asking
 * for cannot express the wrong thing.
 */
function GradeDialog({ submission, maxScore, onClose, onSaved }: GradeDialogProps): ReactElement {
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');

  const save = useMutation({
    mutationFn: (payload: { score?: number; feedback: string; returnIt: boolean }) =>
      payload.returnIt
        ? api.post<AssignmentSubmissionRow>(`/submissions/${submission?.id}/return`, {
            feedback: payload.feedback,
          })
        : api.post<AssignmentSubmissionRow>(`/submissions/${submission?.id}/grade`, {
            ...(payload.score === undefined ? {} : { score: payload.score }),
            feedback: payload.feedback,
          }),
    onSuccess: async () => {
      toast.success('Recorded');
      onClose();
      await onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.byField.score !== undefined) {
        toast.error(error.byField.score);
        return;
      }
      toast.fromError(error, 'Could not record that');
    },
  });

  const trimmed = feedback.trim();
  // A return REQUIRES a reason — that is `returnSubmissionSchema` — and a mark alone
  // is legal because a numeric grade with no comment is a real thing to send. The
  // button state is decided from the same rules the API binds, so the button that
  // would be answered 422 is disabled instead of sent.
  const canReturn = trimmed.length > 0;
  const canGrade = trimmed.length > 0 || score.trim() !== '';

  return (
    <Dialog open={submission !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Record a mark"
        description={
          submission
            ? `${submission.student.name}, attempt ${submission.attempt}, out of ${maxScore}.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              onClick={onClose}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              block
              className="sm:w-auto"
              disabled={!canReturn || save.isPending}
              loading={save.isPending}
              onClick={() => save.mutate({ feedback: trimmed, returnIt: true })}
            >
              Return for another go
            </Button>
            <Button
              block
              className="sm:w-auto"
              loading={save.isPending}
              disabled={!canGrade}
              onClick={() =>
                save.mutate({
                  ...(score.trim() === '' ? {} : { score: Number(score) }),
                  feedback: trimmed,
                  returnIt: false,
                })
              }
            >
              Record mark
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {submission ? (
            <p className="text-xs text-fg-tertiary break-all">
              {describeUpload(submission.upload)}
            </p>
          ) : null}

          <FormField
            label="Mark"
            hint={`Out of ${maxScore}. Leave empty to send the work back instead.`}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              disabled={save.isPending}
              value={score}
              onChange={(event) => setScore(event.target.value)}
            />
          </FormField>

          <FormField label="Feedback" hint="Required when you return work. Optional with a mark.">
            <Textarea
              autoResize
              rows={4}
              disabled={save.isPending}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { GradeDialog };
