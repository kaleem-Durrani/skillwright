import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';
import { Gate } from '@/components/Gate';
import { Button } from '@/components/ui/Button';
import { enrollmentSubject } from './enrollmentSubject';

/**
 * Phase 1's row actions: recording a qualification, and taking it back.
 *
 * WHY THIS IS A COMPONENT AND NOT INLINE JSX: `DataTable` builds exactly ONE DOM
 * copy per row and picks the card list or the table from `useIsDesktop()`
 * (DataTable.tsx's header comment), so an affordance has to be placed twice — once
 * from the `actions` prop and once inside `renderCard`. That is not a fallback
 * arrangement; wiring only one of them is how the resources tab's download button
 * spent a phase being visible on a phone and unreachable on a laptop.
 *
 * WHY ONLY TWO OF THE FOUR VERBS APPEAR HERE. `ALLOWED_TRANSITIONS`
 * in enrollments.service.ts is the whole contract:
 *
 *   PENDING   → APPROVED | REJECTED | WITHDRAWN
 *   APPROVED  → REJECTED | WITHDRAWN | COMPLETED
 *   COMPLETED → APPROVED
 *
 * so a COMPLETED row is TERMINAL for approve, reject and withdraw alike: all three
 * are refused with 409 by `assertTransition`, and offering them would be three
 * buttons guaranteed to fail. Complete is in turn only legal FROM APPROVED, which
 * is why it is not a third button beside Approve/Reject on a PENDING row — the
 * request has not been agreed yet, so there is no seat that could have been
 * completed. A PENDING row is left to the page's existing Approve/Reject pair and
 * renders nothing here.
 *
 * Each button is `Gate`d on the verb it fires, asked with the ROW's subject rather
 * than the course's. `enrollment:complete` and `enrollment:uncomplete` are
 * `ownsCourse` for a TEACHER (`POLICY`), and `ownsCourse` reads
 * `courseTeacherId` — a field that lives on the course, so neither a bare row nor a
 * guess answers it. Widening either gate to make a button appear is the mistake
 * LESSONS-LEARNED #15 records; the answer is a subject that carries the field.
 *
 * The decided date rides with every one of these rows, including the completed
 * one, and it is what this cell showed before Phase 1 added anything: a decision
 * that has no date on screen is a decision nobody can place in time.
 */
export function EnrollmentCompletionActions({
  entry,
  course,
  pending,
  block = false,
  onComplete,
  onUncomplete,
}: {
  entry: EnrollmentDto;
  course: CourseDetail;
  /** True while any decision mutation is in flight, as on the page. */
  pending: boolean;
  /** The card rendering wants a stacked full-width control; the table cell a row. */
  block?: boolean;
  onComplete: (enrollmentId: string) => void;
  onUncomplete: (enrollmentId: string) => void;
}) {
  const target = enrollmentSubject(entry, course);

  if (entry.status === 'APPROVED' || entry.status === 'COMPLETED') {
    const completing = entry.status === 'APPROVED';
    return (
      <div
        className={cn(
          'flex gap-2',
          block ? 'flex-col items-stretch' : 'flex-row items-center justify-end',
        )}
      >
        <Gate
          action={completing ? 'enrollment:complete' : 'enrollment:uncomplete'}
          subject={target}
        >
          <Button
            size="sm"
            variant={completing ? 'primary' : 'secondary'}
            block={block}
            disabled={pending}
            onClick={() => (completing ? onComplete(entry.id) : onUncomplete(entry.id))}
          >
            {completing ? 'Complete' : 'Uncomplete'}
          </Button>
        </Gate>
        <span className="text-xs text-fg-tertiary">{formatDate(entry.decidedAt)}</span>
      </div>
    );
  }

  /*
   * REJECTED and WITHDRAWN. The decided date is the whole truth about those rows,
   * and this is the branch that existed before Phase 1: a viewer who may do nothing
   * still reads a row rather than an empty cell.
   */
  return <span className="text-xs text-fg-tertiary">{formatDate(entry.decidedAt)}</span>;
}

/**
 * What a COMPLETED row says beyond its status chip: WHEN the qualification was
 * recorded and WHO recorded it.
 *
 * `completedAt` and `completedBy` arrived on the DTO with the Phase 1 backend
 * (enrollment.ts:32-38) and are written and cleared as one statement, so they are
 * never half-present — a row that says COMPLETED without a stamp here is a data
 * problem, and the honest rendering of one says nothing rather than inventing a
 * date. `completedBy` is the actor, because the migration's `onDelete: SetNull` on
 * the FK exists precisely so the record of WHO signed a qualification outlives the
 * account.
 *
 * `formatDate` returns an em dash for null, so the null case would otherwise render
 * a quiet "— · recorded by —" under a chip that claims a qualification exists. The
 * early return is what stops that.
 */
export function CompletionStamp({ enrollment }: { enrollment: EnrollmentDto }) {
  if (enrollment.completedAt === null) return null;
  return (
    <span className="text-2xs text-fg-tertiary">
      {formatDate(enrollment.completedAt)}
      {enrollment.completedBy !== null ? ` · recorded by ${enrollment.completedBy.name}` : ''}
    </span>
  );
}
