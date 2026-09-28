import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { formatOfferingDates } from '@/lib/offerings';
import { qk } from '@/lib/query';
import { subject, usePolicy } from '@/lib/policy';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { ApiError } from '@/lib/problem';
import type { EnrollmentDto } from '@/lib/types';
import { EnrollmentAttendance } from '@/components/attendance/EnrollmentAttendance';
import { CompletionStamp } from '@/components/courses/EnrollmentCompletionActions';
import { PageHeader } from '@/components/layout/PageHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '@/components/ui/StatusChip';
import { Route as enrollmentDetailRoute } from '@/routes/_app/enrollments.$id';

/**
 * `GET /enrollments/:id` — one seat, with the record of how it was decided.
 *
 * WHY THE QUERY IS NOT GATED ON A CLIENT-SIDE `can()`, which is the rule this
 * repository is most often bitten by. `enrollment:read` is `isEnrolledStudent` for
 * a student and `ownsCourse` for a teacher, and both read subject fields the page
 * does not have yet — `studentId` and `courseTeacherId` live on the RESPONSE. A
 * subject-free `can('enrollment:read')` is therefore a guaranteed denial
 * (LESSONS-LEARNED #15), and it is worse than useless as React Query's `enabled`:
 * a disabled query stays `status: 'pending'` in v5, so the page would render its
 * skeleton forever for every legitimate viewer. The server is the authority here
 * and it refuses with 403; the two states that answer are rendered separately
 * below, because "you may not read this" and "this failed to load" are different
 * sentences for the person looking at them.
 *
 * Everything ON the page that needs a decision — the attendance summary, the back
 * link to the course — is gated properly, once the row exists, with a subject
 * built field-for-field from the DTO.
 */
export function EnrollmentDetailPage() {
  const { id } = useParams({ from: enrollmentDetailRoute.id });
  const policy = usePolicy();

  const enrollment = useQuery({
    queryKey: qk.enrollment(id),
    queryFn: () => api.get<EnrollmentDto>(`/enrollments/${id}`),
  });

  if (enrollment.isPending) {
    return (
      <EmptyState
        variant="empty"
        title="Loading this seat"
        description="Fetching the record for this enrolment."
      />
    );
  }

  if (enrollment.isError) {
    const error = enrollment.error;
    const refused = error instanceof ApiError && error.status === 403;
    return (
      <EmptyState
        variant="error"
        title={refused ? 'Not available to you' : "That didn't load"}
        description={
          refused
            ? 'This enrolment belongs to a course you are not teaching and is not your own seat.'
            : 'This enrolment could not be loaded. Nothing you did caused this.'
        }
        action={
          refused ? (
            <Button asChild variant="secondary">
              <Link to="/courses" search={{ page: 1 }}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back to courses
              </Link>
            </Button>
          ) : undefined
        }
        actionLabel={refused ? undefined : 'Try again'}
        onAction={refused ? undefined : () => void enrollment.refetch()}
      />
    );
  }

  const row = enrollment.data;

  /*
   * The subject for the two gates this page asks, named field for field against
   * the server's `loadEnrollmentSubject` (enrollments.service.ts). `isEnrolledStudent`
   * reads `studentId` and `ownsCourse` reads `courseTeacherId`; a spread of the
   * DTO would contribute neither, because the DTO nests the course summary and
   * the person, and every `Subject` field is optional so nothing would complain
   * (LESSONS-LEARNED #18). `enrollmentStatus` is deliberately absent — actor.ts
   * defines it as the REQUESTING actor's status in the relevant course, not the
   * status of an arbitrary row, and no rule consulted here reads it.
   */
  const viewerSubject = subject({
    id: row.id,
    studentId: row.student.id,
    courseId: row.course.id,
    courseTeacherId: row.course.teacher.id,
    publishedAt: row.course.publishedAt,
  });

  /*
   * The link back is to the COURSE, and it is gated on `course:read` with the
   * course subject rather than rendered unconditionally. An admin is entitled to
   * every enrolment, including one hanging off a DRAFT course they are not
   * otherwise allowed to open — a bare link would offer a navigation that answers
   * 403, which is the affordance-that-lies problem this repository keeps
   * documenting. `isPublished` is what the anonymous and student rows read, and
   * `ownsCourse` is what the teacher's does, so the subject has to carry both the
   * teacher and the publication date or the check is wrong for somebody.
   */
  const canOpenCourse = policy.can('course:read', viewerSubject);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow={
          canOpenCourse ? (
            <Button asChild variant="ghost" size="sm" className="-ms-2">
              <Link to="/courses/$courseId" params={{ courseId: row.course.id }}>
                <ArrowLeft aria-hidden="true" className="size-4" />
                {row.course.name}
              </Link>
            </Button>
          ) : undefined
        }
        title={row.student.name}
        description={`Seat in ${row.course.name} · ${formatOfferingDates(row.offering)}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          <Card className="flex items-start gap-3">
            <Avatar name={row.student.name} src={row.student.avatarUrl} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {/*
                The student is PLAIN TEXT and deliberately not a link to
                `/users/$id`. `user:read` is `isSelf` for a teacher, so the very
                teacher looking at this roster would be refused the page behind
                such a link — an affordance that renders and then 403s is worse
                than no affordance. `EnrollmentDto.student` is a `UserSummary`
                (user.ts) and carries no email, which is the right amount to know
                about somebody on a roster.
              */}
              <span className="truncate text-base font-medium">{row.student.name}</span>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={row.status} />
                <CompletionStamp enrollment={row} />
              </div>
            </div>
          </Card>

          {/*
            The decision. `decisionNote` is the approval note, the mandatory
            rejection reason and the completion note — one column for three
            verdicts, and the only one of them the student is shown as THE reason
            (a rejection). Rendering it for every status rather than only for
            REJECTED is what stops an approved row from quietly hiding why it was
            approved, and stops a completed row from hiding who recorded it.
          */}
          <Card className="flex flex-col gap-3">
            <CardTitle className="text-base">The record</CardTitle>
            <dl className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
              <Row label="Requested" value={formatDateTime(row.requestedAt)} />
              <Row
                label="Decided"
                value={
                  row.decidedAt
                    ? `${formatDateTime(row.decidedAt)}${
                        row.decidedBy ? ` by ${row.decidedBy.name}` : ''
                      }`
                    : 'Not decided yet'
                }
              />
              {/*
                "Completed ON", not "Completed": the status chip above already says
                "Completed", and two controls on one screen carrying the same word
                makes a screen-reader user hear the state twice and learn nothing
                the second time.
              */}
              <Row
                label="Completed on"
                value={
                  row.completedAt
                    ? `${formatDateTime(row.completedAt)}${
                        row.completedBy ? ` by ${row.completedBy.name}` : ''
                      }`
                    : 'Not completed'
                }
              />
              <Row label="Last change" value={formatRelative(row.requestedAt)} />
            </dl>
            {row.decisionNote ? (
              <p className="rounded-[var(--control-radius)] bg-sunken p-3 text-sm text-fg-secondary">
                {row.decisionNote}
              </p>
            ) : null}
          </Card>

          {/*
            Reuses the component the course page already renders for the same
            seat, rather than a second attendance panel. It builds its own subject
            from the row and returns null for a viewer the policy refuses, so
            nothing here has to decide whether a student may see their own record
            — that question is asked once, in the one place that knows the answer.
          */}
          <EnrollmentAttendance enrollment={row} title="Attendance" />
        </div>

        <Card variant="sunken" className="flex flex-col gap-3">
          <CardTitle className="text-base">Intake</CardTitle>
          <dl className="flex flex-col gap-2.5 text-sm">
            <Row
              label="Dates"
              value={
                row.offering.startDate
                  ? `${formatDate(row.offering.startDate)} – ${formatDate(row.offering.endDate)}`
                  : 'Dates not set'
              }
            />
            <Row
              label="Seats"
              value={`${row.offering.approvedCount} of ${row.offering.capacity} taken`}
            />
            <Row
              label="Workshop places"
              value={
                row.offering.workshopCapacity === null
                  ? 'No workshop cap'
                  : `${row.offering.workshopCapacity - (row.offering.workshopSeatsRemaining ?? 0)} of ${row.offering.workshopCapacity} taken`
              }
            />
            <Row label="Course code" value={row.course.code} />
            <Row label="Department" value={row.course.department.name} />
            <Row label="Teacher" value={row.course.teacher.name} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

/**
 * One label and one value, as a `<div>` rather than the bare `<dt>`/`<dd>` pair
 * the name suggests. A `<dl>`'s children are `dt`/`dd` groups, and a wrapping
 * `<div>` around each is exactly the grouping the spec wants — the alternative
 * here would be `dl > dt + dd` with no wrapper, which puts the label and the value
 * in one implicit group and makes a two-column grid impossible to align.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-2xs font-medium tracking-wide text-fg-tertiary uppercase">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}
