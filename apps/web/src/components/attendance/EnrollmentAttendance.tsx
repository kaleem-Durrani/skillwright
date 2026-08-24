import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { subject, usePolicy, type PolicySubject } from '@/lib/policy';
import { useSession } from '@/lib/session';
import type { AttendanceSummaryDto, EnrollmentDto } from '@/lib/types';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { AttendanceSummary } from './AttendanceSummary';

export interface EnrollmentAttendanceProps {
  /** The enrolment whose attendance is summarised — the SUBJECT is this row. */
  enrollment: EnrollmentDto;
  /**
   * Heading above the counts. Omitted renders no heading at all — a parent that
   * already owns the page hierarchy supplies its own, and two headings saying
   * "Your attendance" one under the other is one too many.
   */
  title?: string;
}

/**
 * One enrolment's own attendance, fetched only for viewers the policy allows.
 *
 * THE SUBJECT IS THE ENROLMENT ROW, and it is built field-for-field to match the
 * server's second loader for `attendance:read` — `loadEnrollmentSubject`
 * (attendance.service.ts:74-87): `{ id, studentId, courseId, courseTeacherId }`.
 *
 * WHY not the course subject that gates the register: `attendance:read`'s STUDENT
 * cell is `isEnrolledStudent`, which reads `subject.studentId`
 * (combinators.ts:75-79). A COURSE subject has no `studentId`, so the rule reads an
 * absent field and DENIES — the exact wrong-SHAPE failure LESSONS-LEARNED #31
 * records. Passing it would have hidden this summary from every student it exists
 * for, silently.
 *
 * The same rule is why the gate is asked PER ROW rather than once for a list: each
 * row carries its own `id`, and a list of enrolments has no single subject. The
 * server scopes what arrives here anyway (`visibilityWhere`,
 * enrollments.service.ts:217-236), so the client gate is the UI half — no request
 * is even configured for a viewer who would be answered 403.
 */
export function EnrollmentAttendance({ enrollment, title }: EnrollmentAttendanceProps) {
  const { user } = useSession();
  const policy = usePolicy();

  const summarySubject: PolicySubject | undefined = user
    ? subject({
        id: enrollment.id,
        studentId: user.id,
        courseId: enrollment.course.id,
        courseTeacherId: enrollment.course.teacher.id,
      })
    : undefined;

  const allowed = policy.can('attendance:read', summarySubject);

  const summary = useQuery({
    queryKey: qk.enrollmentAttendance(enrollment.id),
    queryFn: () => api.get<AttendanceSummaryDto>(`/enrollments/${enrollment.id}/attendance`),
    enabled: allowed,
  });

  if (!allowed) return null;

  return (
    <Card className="flex flex-col gap-3">
      {title ? <CardTitle className="text-base">{title}</CardTitle> : null}

      {summary.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <div className="grid grid-cols-3 gap-2">
            <Skeleton shape="block" className="h-14" />
            <Skeleton shape="block" className="h-14" />
            <Skeleton shape="block" className="h-14" />
          </div>
          <Skeleton shape="text" className="w-3/5" />
          <Skeleton shape="text" className="w-2/5" />
        </div>
      ) : summary.data ? (
        <AttendanceSummary summary={summary.data} />
      ) : (
        <EmptyState
          variant="error"
          compact
          description="Your attendance could not be loaded."
          actionLabel="Try again"
          onAction={() => summary.refetch()}
        />
      )}
    </Card>
  );
}
