import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_PAGE_SIZE, withdrawEnrollmentSchema } from '@skillwright/shared/schema';
import { api, type Paginated } from '@/lib/api';
import { courseViewerStatus, formatOfferingDates } from '@/lib/offerings';
import { qk } from '@/lib/query';
import { useSession } from '@/lib/session';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';
import { Gate } from '@/components/Gate';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { SkeletonList } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { enrollmentSubject } from './enrollmentSubject';

/**
 * The VIEWER'S OWN seat, and the one verb that belongs to it: withdrawing.
 *
 * `POST /enrollments/:id/withdraw` has existed, with a policy gate and a reason
 * field, and nothing in the SPA has ever called it — so a student could request a
 * place and then had no way to take it back. The gap is Phase 5's first hole, and
 * it closes here rather than on the roster because a withdrawal is not a staff
 * action: `enrollment:withdraw` is `isEnrolledStudent` for a STUDENT and a bare
 * `deny` for a TEACHER (policy.ts:227-233), and a teacher removing someone is a
 * REJECTION — a separate verb, a separate audit row, a separate notification.
 *
 * WHY "THE VIEWER'S OWN ROW" IS COMPARED RATHER THAN ASSUMED. The page already
 * carries `viewerEnrollmentStatus` per intake, and that field is served only for
 * STUDENT viewers, so deriving the row from it would be a shortcut that quietly
 * stops working for an admin who happens to hold a seat of their own. Instead the
 * rows are fetched and matched on `row.student.id === sessionUser.id`, which is the
 * same comparison the server's own `visibilityWhere` makes
 * (enrollments.service.ts:292-316) and is true for every role.
 *
 * `viewerEnrollmentStatus` is still what decides whether the LOOKUP RUNS, because
 * "does this viewer hold any row at all" is a question the course payload has
 * already answered, and asking it again would put a second list on every course
 * page. No policy is read here — it gates a fetch, and a fetch that never happens
 * renders nothing.
 *
 * WHY PENDING IS WITHDRAWABLE AND THAT IS THE POINT. The plan's wording was "a
 * student cannot withdraw from a course they requested": the request is exactly the
 * state where changing your mind matters most, since the teacher is holding a
 * waiting list. `ALLOWED_TRANSITIONS` agrees — PENDING → WITHDRAWN and APPROVED →
 * WITHDRAWN, and nothing out of REJECTED, WITHDRAWN or COMPLETED.
 */
export function ViewerSeatActions({ course }: { course: CourseDetail }) {
  const { user } = useSession();
  const client = useQueryClient();
  const [withdrawing, setWithdrawing] = useState<EnrollmentDto | null>(null);

  const holdsSomething = courseViewerStatus(course.offerings) !== null;

  const mine = useQuery({
    queryKey: qk.enrollments({ courseId: course.id, limit: MAX_PAGE_SIZE }),
    queryFn: () =>
      api.get<Paginated<EnrollmentDto>>('/enrollments', {
        query: { courseId: course.id, limit: MAX_PAGE_SIZE },
      }),
    enabled: user !== null && holdsSomething,
  });

  /*
   * `settle()` DELETES A SEAT: a withdrawal from APPROVED decrements
   * `CourseOffering.approvedCount` (enrollments.service.ts:711-719), so the intake
   * card above this — its chip, its `seatsRemaining`, its `isFull` — is stale the
   * moment the call lands. `qk.course` is that payload.
   *
   * The `['enrollments']` PREFIX, not one key: the self-scoped list is read by three
   * places with three different keys — this section, the completed-rungs lookup
   * behind every enrol button, and the viewer's own attendance below — and only a
   * prefix sweep reaches all of them. Invalidating one would leave a completed
   * course still counting towards a prerequisite.
   */
  const withdraw = useMutation({
    mutationFn: ({ row, reason }: { row: EnrollmentDto; reason: string | undefined }) =>
      api.post<EnrollmentDto>(
        `/enrollments/${row.id}/withdraw`,
        // The key is OMITTED rather than sent as undefined when the student wrote
        // nothing: the route binds the body `.nullish()` and an empty `reason` would
        // land in `decisionNote` as an empty string, which is not the same as the null
        // `settle` writes for a reasonless withdrawal.
        reason === undefined ? {} : { reason },
      ),
    onSuccess: async () => {
      setWithdrawing(null);
      toast.success('You have withdrawn', {
        description: 'Your place is released and the teacher has been told.',
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.course(course.id) }),
        client.invalidateQueries({ queryKey: ['enrollments'] }),
      ]);
    },
    onError: (error) => toast.fromError(error, 'Could not withdraw from this course'),
  });

  const rows = (mine.data?.data ?? []).filter(
    (row) => row.student.id === user?.id && (row.status === 'PENDING' || row.status === 'APPROVED'),
  );

  // Loaded-or-nothing: a section that pops in under the intakes reads as a mistake,
  // and one that never arrives leaves a hole where a control used to be.
  if (rows.length === 0) {
    if (holdsSomething && user !== null && mine.isPending) {
      return (
        <div className="pt-(--space-section)">
          <SkeletonList rows={1} />
        </div>
      );
    }
    return null;
  }

  return (
    <section aria-labelledby="viewer-seat" className="pt-(--space-section) flex flex-col gap-3">
      <div>
        <h2 id="viewer-seat" className="font-display text-lg font-semibold">
          Your place
        </h2>
        <p className="text-sm text-fg-secondary">
          You can give this place back at any time. The teacher is told, and the record is kept —
          asking again on a later intake is a new request, not a reinstatement.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <ViewerSeatCard
              row={row}
              course={course}
              onWithdraw={() => setWithdrawing(row)}
              withdrawing={withdraw.isPending && withdraw.variables?.row.id === row.id}
            />
          </li>
        ))}
      </ul>

      {/*
        Remounted per target by `key`, for the reason `RejectDialog` carries one: the
        reason box is component state, and a dialog seeded once would open on the
        SECOND seat still holding the text typed for the first.
      */}
      <WithdrawDialog
        key={withdrawing?.id ?? 'none'}
        row={withdrawing}
        pending={withdraw.isPending}
        onClose={() => setWithdrawing(null)}
        onConfirm={(reason) => withdrawing && withdraw.mutate({ row: withdrawing, reason })}
      />
    </section>
  );
}

/**
 * One intake the viewer holds a live seat on, with the one control that seat
 * answers to. `Gate`d per row rather than per section because the subject is the
 * row: a viewer may hold two seats and be entitled to withdraw one of them.
 */
function ViewerSeatCard({
  row,
  course,
  onWithdraw,
  withdrawing,
}: {
  row: EnrollmentDto;
  course: CourseDetail;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {/*
          The intake dates open `GET /enrollments/:id` — the seat's own page, with
          who decided it and when. A link and not a button, because there is nothing
          to confirm: it is a record to read, and a card whose only control opened a
          record would be a button wearing a record's clothes.
        */}
        <Link
          to="/enrollments/$id"
          params={{ id: row.id }}
          className="tap -my-2 flex w-fit items-center rounded-[var(--control-radius)] px-1 text-sm font-medium hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
        >
          <span className="truncate">{formatOfferingDates(row.offering)}</span>
        </Link>
        <StatusChip status={row.status} />
      </div>
      <Gate action="enrollment:withdraw" subject={enrollmentSubject(row, course)}>
        <Button
          variant="secondary"
          size="sm"
          block
          loading={withdrawing}
          className="sm:w-auto sm:self-center"
          onClick={onWithdraw}
        >
          Withdraw
        </Button>
      </Gate>
    </Card>
  );
}

/**
 * The withdrawal confirmation, and its reason field.
 *
 * THE REASON IS OPTIONAL, and the copy says so. `withdrawEnrollmentSchema` is
 * `reason: z.string().trim().max(500).optional()` and the route binds it
 * `.nullish()` (enrollment.ts:67-70, enrollments.routes.ts:154-174), so a student
 * who withdraws saying nothing sends no body at all and is answered 200. The
 * Messages screen's empty state has long promised a reason field for a different
 * flow; copying that promise here would have been the same lie pointed at an
 * endpoint that does not require it.
 *
 * It is still OFFERED, because `settle` stores it in `decisionNote`
 * (enrollments.service.ts:721-732) and the teacher — who now holds a seat to
 * re-offer — reads that column on the roster this very page renders. So the field
 * is optional in the contract and useful in practice, and those are different
 * sentences that both belong on screen.
 */
function WithdrawDialog({
  row,
  pending,
  onClose,
  onConfirm,
}: {
  row: EnrollmentDto | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState('');

  /*
   * The shared schema's own rule rather than a length copied out of it, so a widened
   * `max(500)` on the wire disables this button on the same commit — the arrangement
   * `CourseDetail`'s `RejectDialog` uses for `rejectEnrollmentSchema`.
   */
  const parsed = withdrawEnrollmentSchema.safeParse({ reason });
  const isValid = parsed.success;
  /*
   * An empty box is NO reason, and the two must not go to the server as the same
   * thing. The schema trims, so `'   '` parses to `''` and `''` is a perfectly valid
   * optional string — which means passing `parsed.data.reason` straight through sends
   * `{ reason: '' }`, and `settle` would store an empty string in `decisionNote` where
   * every other reasonless withdrawal has a null. The test that pins this caught it.
   */
  const submitted = parsed.success && parsed.data.reason !== '' ? parsed.data.reason : undefined;

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        title="Withdraw from this course?"
        description={
          row
            ? `Your place on the ${formatOfferingDates(row.offering)} intake is released, and the teacher is told.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={pending}
              onClick={onClose}
            >
              Keep my place
            </Button>
            <Button
              variant="danger"
              block
              className="sm:w-auto"
              loading={pending}
              disabled={!isValid}
              onClick={() => onConfirm(submitted)}
            >
              Withdraw
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-fg-secondary">
            The record is kept — this is a withdrawal, not a deletion — and you can ask for another
            place on a later intake.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Reason</span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoResize
              disabled={pending}
              placeholder="My timetable has changed and I cannot make the Thursday sessions."
            />
            <span className="text-2xs text-fg-tertiary">
              Optional, up to 500 characters. The teacher reads this beside your withdrawal.
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
