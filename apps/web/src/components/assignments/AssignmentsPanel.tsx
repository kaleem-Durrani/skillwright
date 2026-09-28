import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AssignmentDto, MyAssignmentDto } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { courseViewerStatus } from '@/lib/offerings';
import { formatDate, formatRelative } from '@/lib/format';
import { qk } from '@/lib/query';
import { subject, usePolicy, type PolicySubject } from '@/lib/policy';
import { useSession } from '@/lib/session';
import type { CourseDetail, ViewerCourseOffering } from '@/lib/types';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { toast } from '@/components/ui/Toast';
import { AssignmentFormDialog } from './AssignmentFormDialog';
import { SubmissionDialog, describeUpload } from './SubmissionDialog';
import { SubmissionsPanel } from './SubmissionsPanel';

export interface AssignmentsPanelProps {
  course: CourseDetail;
  /** The intake this tab is scoped to, chosen by the caller from `course.offerings`. */
  offering: ViewerCourseOffering | undefined;
}

/**
 * The Assignments tab, and the ONE place that decides which of the two audiences is
 * being rendered.
 *
 * The branch is on the VIEWER'S ROLE, read once here rather than asked of the policy
 * four times. It is not a permission: both branches call the same server endpoints,
 * and the endpoints decide. A role read that only chooses WHICH of two correct
 * renderings to show is the one legitimate use of `role ===` outside the policy
 * module — the same arrangement `ViewerAttendanceSection` on this page uses, and for
 * the same reason.
 *
 * What it is NOT is a way to skip a gate. A student cannot reach the teacher's half
 * by any state this component holds, because the half is chosen from the session and
 * the API refuses the teacher routes to them regardless: `assignment:create` is
 * `STUDENT:deny`, and the class list is gated on `submission:read` with a subject that
 * carries no `studentId` for them to match.
 */
export function AssignmentsPanel({ course, offering }: AssignmentsPanelProps): ReactElement {
  const { user } = useSession();
  if (user?.role === 'STUDENT') {
    return <StudentAssignments course={course} />;
  }
  return <TeacherAssignments course={course} offering={offering} />;
}

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------

/**
 * What the student owes, and what they have already handed in.
 *
 * ONE request, and the endpoint behind it is the phase's one-query claim: the server
 * joins each task to the viewer's own hand-in and the mark on it, so this screen never
 * fans out into a query per task. `courseId` narrows the join to the page the student
 * is looking at; the endpoint is cross-course by design, because a student sits in
 * several intakes and their deadlines are all deadlines.
 */
function StudentAssignments({ course }: { course: CourseDetail }): ReactElement {
  const [handingIn, setHandingIn] = useState<MyAssignmentDto | null>(null);

  const mine = useQuery({
    queryKey: qk.myAssignments({ courseId: course.id }),
    queryFn: () =>
      api.get<{ data: MyAssignmentDto[] }>('/assignments/mine', {
        query: { courseId: course.id },
      }),
  });

  if (mine.isPending) return <SkeletonList rows={3} />;

  const rows = mine.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        variant="empty"
        title="No tasks set yet"
        description={
          courseViewerStatus(course.offerings) === 'APPROVED'
            ? 'Your teacher has not set anything for this course yet. Anything they set appears here with its deadline.'
            : 'Tasks are set per intake, and are only shown to students holding a seat on it.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <AssignmentCard key={row.id} row={row} onHandIn={() => setHandingIn(row)} />
      ))}

      {handingIn !== null ? (
        <SubmissionDialog
          key={handingIn.id}
          open
          onOpenChange={(open) => !open && setHandingIn(null)}
          assignmentId={handingIn.id}
          attempt={(handingIn.submission?.attempt ?? 0) + 1}
          overdue={handingIn.overdue}
          {...(handingIn.submission?.status === 'RETURNED'
            ? { returnedFeedback: handingIn.submission.feedback }
            : {})}
        />
      ) : null}
    </div>
  );
}

function AssignmentCard({
  row,
  onHandIn,
}: {
  row: MyAssignmentDto;
  onHandIn: () => void;
}): ReactElement {
  // Narrowed ONCE into a local, because `row.submission` is nullable and every read
  // below would otherwise re-prove it. `submitted` is then derivable rather than
  // separately tracked, so the two can never disagree.
  const mine = row.submission;
  const returned = mine?.status === 'RETURNED';

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{row.title}</CardTitle>
          <p className="text-2xs text-fg-tertiary">
            Due {formatDate(row.dueAt)} · out of {row.maxScore}
            {row.overdue ? ' · deadline passed' : ''}
          </p>
        </div>
        {mine !== null ? <StatusChip status={mine.status} /> : null}
      </div>

      {/*
        The brief is the teacher's own words, rendered in full and NOT collapsed: a
        student who has to guess what a task wants is a student who guesses wrong, and
        `line-clamp` here would hide the instruction rather than tidy the page.
      */}
      <p className="text-sm whitespace-pre-line text-fg-secondary">{row.brief}</p>

      {mine !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-sunken px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-fg-secondary">
              {returned ? 'Sent back' : 'Handed in'} {formatRelative(mine.submittedAt)}
              {mine.attempt > 1 ? ` · attempt ${mine.attempt}` : ''}
            </span>
            {/*
              Null renders nothing, not "0%". A zero is a mark somebody gave; an
              ungraded hand-in has had none, and the server sends null precisely so a
              client cannot invent one.
            */}
            {row.scorePercent !== null ? (
              <span className="text-sm font-medium text-fg">
                {mine.score} / {row.maxScore} ({row.scorePercent}%)
              </span>
            ) : null}
          </div>
          <p className="text-2xs text-fg-tertiary break-all">{describeUpload(mine.upload)}</p>
          {mine.feedback ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-fg-secondary">
                {mine.gradedBy === null ? 'Feedback' : `${mine.gradedBy.name}’s feedback`}
              </span>
              <p className="text-sm text-fg">{mine.feedback}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        One button, below `md` full width — it is the primary action of this card and a
        thumb should not have to aim — shrinking to its label from `sm`.
      */}
      <Button
        block
        className="self-start sm:w-auto"
        variant={returned || mine === null ? 'primary' : 'secondary'}
        onClick={onHandIn}
      >
        {returned
          ? 'Hand in again'
          : mine !== null
            ? 'Hand in another attempt'
            : 'Hand in your work'}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Teacher / admin
// ---------------------------------------------------------------------------

/**
 * The teacher's half: one intake's tasks, each expandable into the class that handed
 * in for it.
 *
 * The task list is scoped to the INTAKE the parent selected, and that is not a
 * convenience: a deadline belongs to a run of the course, so a template re-run five
 * times a year has five separate lists with five separate deadlines. Showing them all
 * at once under one heading would be a category error, and the server would not even
 * answer it — there is no endpoint that lists a course's tasks across intakes without
 * naming one.
 */
function TeacherAssignments({
  course,
  offering,
}: {
  course: CourseDetail;
  offering: ViewerCourseOffering | undefined;
}): ReactElement {
  const policy = usePolicy();
  const client = useQueryClient();
  const [form, setForm] = useState<AssignmentDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AssignmentDto | null>(null);

  /*
   * The offering as the assignment subject. `assignment:create` is `ownsCourse`, which
   * reads `courseTeacherId` — a field that lives on the COURSE, so a bare offering row
   * cannot answer the question being asked. Being NARROWER than the server is the safe
   * direction: it hides a button the API would refuse rather than showing one it would
   * 403.
   */
  const offeringSubject: PolicySubject = subject({
    id: offering?.id,
    courseId: course.id,
    courseTeacherId: course.teacher.id,
    publishedAt: course.publishedAt,
  });
  const canSet = offering !== undefined && policy.can('assignment:create', offeringSubject);

  const tasks = useQuery({
    queryKey: qk.offeringAssignments(offering?.id ?? 'none'),
    queryFn: () => api.get<AssignmentDto[]>(`/offerings/${offering?.id}/assignments`),
    enabled: offering !== undefined,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del<void>(`/assignments/${id}`),
    onSuccess: async () => {
      setDeleting(null);
      toast.success('Task removed', {
        description: 'It is gone from the intake. Hand-ins already recorded are kept.',
      });
      await client.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (error) => toast.fromError(error, 'Could not remove that task'),
  });

  if (offering === undefined) {
    return (
      <EmptyState
        variant="empty"
        title="This course has no live intake"
        description="Tasks belong to an intake, so there is nothing to set until one exists. Add one from the course header."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {canSet ? (
        <div className="flex flex-col sm:flex-row sm:justify-end">
          <Button
            block
            className="sm:w-auto"
            leadingIcon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => setForm('new')}
          >
            Set a task
          </Button>
        </div>
      ) : null}

      {tasks.isPending ? (
        <SkeletonList rows={3} />
      ) : (
        <div className="flex flex-col gap-3">
          {(tasks.data ?? []).map((task) => (
            <Card key={task.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <CardTitle>{task.title}</CardTitle>
                  <p className="text-2xs text-fg-tertiary">
                    Due {formatDate(task.dueAt)} · out of {task.maxScore}
                  </p>
                </div>
                {/*
                  The row menu has to be called from BOTH renderings, because they are
                  not a fallback and a primary: the class list below is cards below
                  `md` and a table from `md` up, chosen by viewport, never both at once.
                */}
                {canSet ? (
                  <AssignmentRowMenu
                    assignment={task}
                    onEdit={() => setForm(task)}
                    onDelete={() => setDeleting(task)}
                  />
                ) : null}
              </div>
              <p className="text-sm whitespace-pre-line text-fg-secondary">{task.brief}</p>
              <SubmissionsPanel assignment={task} />
            </Card>
          ))}

          {(tasks.data ?? []).length === 0 ? (
            <EmptyState
              variant="empty"
              title="No tasks on this intake yet"
              description={
                canSet
                  ? 'Set one and every student holding a seat here sees it with its deadline.'
                  : 'Nothing has been set for this intake.'
              }
              {...(canSet ? { actionLabel: 'Set a task', onAction: () => setForm('new') } : {})}
            />
          ) : null}
        </div>
      )}

      <AssignmentFormDialog
        key={form !== null && form !== 'new' ? form.id : 'new'}
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
        offeringId={offering.id}
        courseId={course.id}
        assignment={form !== null && form !== 'new' ? form : undefined}
        /*
         * A week before the intake ends, or four weeks out when its dates are not set
         * yet. Derived here rather than inside the dialog because "this intake's own
         * dates" is a fact the parent already holds and a hard-coded +7 days in a form
         * would be a second, dumber answer to a question this page can already answer.
         */
        defaultDueAt={defaultDueAt(offering)}
      />

      <DeleteAssignmentDialog
        assignment={deleting}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting !== null && remove.mutate(deleting.id)}
      />
    </div>
  );
}

/**
 * A sensible starting deadline: a week before the intake ends, or four weeks out when
 * its end date is not decided yet.
 */
function defaultDueAt(offering: ViewerCourseOffering): string {
  const end = offering.endDate === null ? null : new Date(offering.endDate);
  if (end !== null && !Number.isNaN(end.getTime())) {
    end.setDate(end.getDate() - 7);
    return end.toISOString();
  }
  const fourWeeks = new Date();
  fourWeeks.setDate(fourWeeks.getDate() + 28);
  return fourWeeks.toISOString();
}

function AssignmentRowMenu({
  assignment,
  onEdit,
  onDelete,
}: {
  assignment: AssignmentDto;
  onEdit: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          // The label names the ROW. "Actions" alone is what a screen reader hears
          // from every one of these buttons in a list of three.
          aria-label={`Actions for ${assignment.title}`}
          icon={<MoreVertical className="size-5" />}
          size="sm"
          className="self-start"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<Pencil aria-hidden="true" className="size-4" />} onSelect={onEdit}>
          Edit task
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          icon={<Trash2 aria-hidden="true" className="size-4" />}
          onSelect={onDelete}
        >
          Remove task
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The delete confirmation — and specifically NOT a promise that this can be undone.
 *
 * What actually happens, read rather than assumed: the API stamps `deletedAt` and
 * nothing else. The hand-ins survive, and so do their marks, because a class's graded
 * work outlives the task that collected it and a certificate will divide a total by
 * `maxScore`. No screen in this app puts a deleted task back, so the copy says a
 * database change would, exactly as the suspend dialog's does.
 */
function DeleteAssignmentDialog({
  assignment,
  pending,
  onClose,
  onConfirm,
}: {
  assignment: AssignmentDto | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <Dialog open={assignment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Remove this task?"
        description={
          assignment
            ? `${assignment.title} disappears from this intake for every student.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" block className="sm:w-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              block
              className="sm:w-auto"
              loading={pending}
              onClick={onConfirm}
            >
              Remove task
            </Button>
          </>
        }
      >
        <p className="text-fg-secondary">
          Nothing is erased: the task is marked removed and the hand-ins and their marks are kept.
          No screen in this app puts a task back, so restoring it takes a database change.
        </p>
      </DialogContent>
    </Dialog>
  );
}
