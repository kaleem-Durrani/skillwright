import { cn } from '@/lib/cn';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';
import { Gate } from '@/components/Gate';
import { Button } from '@/components/ui/Button';
import { enrollmentSubject } from '@/components/courses/enrollmentSubject';

/**
 * "Issue certificate" on a COMPLETED enrolment row — the last control in the chain this
 * phase closes, and the only one that is not a status change.
 *
 * WHY IT IS A SEPARATE COMPONENT AND NOT PART OF `EnrollmentCompletionActions`. That
 * component owns the four verbs of `ALLOWED_TRANSITIONS` and says so in its header: it
 * renders Complete or Uncomplete and nothing else. A certificate is not a transition —
 * the seat is already COMPLETED and stays COMPLETED whatever happens here — so folding
 * it in would put a button in a component whose entire argument is that its buttons are
 * the transition map, and a reader checking that map against the UI would find a fifth
 * verb that is not one.
 *
 * WHY IT MUST BE RENDERED TWICE. `DataTable` builds exactly ONE DOM copy per row and
 * picks the card list or the table from `useIsDesktop()` (DataTable.tsx's header
 * comment). These are not a fallback and a primary: the card list is the PRIMARY
 * rendering below `md`. Wiring only the `actions` prop would ship an affordance visible
 * on a laptop and unreachable on a phone, which is how the resources tab's download
 * button spent a phase being complete on one viewport and absent on the other.
 *
 * The gate is `certificate:issue` asked with the ROW's subject, through the same
 * `enrollmentSubject` projection the completion buttons use — and that is not a
 * coincidence: the API decides `certificate:issue` against the SEAT
 * (`loadEnrollmentSubject`), so the subject that matches the server's decision is the
 * seat's, not the course's. Asking with the course would work here by accident and fail
 * the moment a rule read a seat field.
 */
export function EnrollmentCertificateActions({
  entry,
  course,
  block = false,
  onIssue,
}: {
  entry: EnrollmentDto;
  course: CourseDetail;
  /** The card rendering wants a stacked full-width control; the table cell a row. */
  block?: boolean;
  onIssue: (enrollment: EnrollmentDto) => void;
}) {
  /*
   * A COMPLETED seat is the only thing a certificate can hang off — the API refuses
   * anything else with a 409, and that check is deliberately server-side. Rendering the
   * button only for a COMPLETED row is not a second copy of the rule: it is the same
   * reason `EnrollmentCompletionActions` offers Complete only on an APPROVED row, and
   * the affordance for a request that cannot succeed is a button guaranteed to fail.
   */
  if (entry.status !== 'COMPLETED') return null;

  return (
    <Gate action="certificate:issue" subject={enrollmentSubject(entry, course)}>
      <Button
        size="sm"
        variant="secondary"
        block={block}
        className={cn(block ? undefined : 'shrink-0')}
        onClick={() => onIssue(entry)}
      >
        Issue certificate
      </Button>
    </Gate>
  );
}
