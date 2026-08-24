import { Download } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { usePolicy, subject } from '@/lib/policy';
import { Button } from '@/components/ui/Button';

/**
 * The Subject both export endpoints are gated by server-side — the COURSE shape
 * `loadCourseSubject` builds (attendance.service.ts:63-71): `ownsCourse` reads
 * `courseTeacherId`, and `isEnrolledStudent` reads the absent `studentId` and denies,
 * which is exactly why a student never sees either affordance. Named fields, no
 * spread — lib/policy.ts's rule about spreads supplying only the keys that happen to
 * match.
 */
function courseSubject(courseId: string, teacherId: string) {
  return subject({ id: courseId, courseId, courseTeacherId: teacherId });
}

export interface RegisterExportButtonsProps {
  courseId: string;
  teacherId: string;
}

/**
 * Phase 8's download actions on the screen that already lists this data: the
 * enrolment register and the attendance register, each as one plain anchor.
 *
 * WHY an anchor and not fetch-then-blob: these are cookie-authed same-origin
 * endpoints (API_BASE is `/api/v1` on every deployment — api.ts), so navigating an
 * `<a href>` carries the session with no code at all, keeps the server's
 * Content-Disposition filename, streams the file instead of buffering it in JS heap,
 * and gives the browser's own download UX for free. The signed-URL precedent
 * (resources) exists because those bytes live in a DIFFERENT origin (the object
 * store), which is not the case here.
 *
 * The trade is honest: a refusal arrives as a JSON document in a tab rather than a
 * toast. That window can only open for someone whose policy answer CHANGED since the
 * page rendered — the buttons are hidden otherwise — so the anchor rides the exact
 * gates the server enforces.
 */
export function RegisterExportButtons({ courseId, teacherId }: RegisterExportButtonsProps) {
  const policy = usePolicy();
  const viewerSubject = courseSubject(courseId, teacherId);

  const mayReadEnrollments = policy.can('enrollment:read', viewerSubject);
  const mayReadAttendance = policy.can('attendance:read', viewerSubject);
  if (!mayReadEnrollments && !mayReadAttendance) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {mayReadEnrollments ? (
        <Button variant="secondary" size="sm" asChild>
          <a
            href={apiUrl('/enrollments/export', { courseId })}
            download="enrollments.csv"
            aria-label="Export the enrolment register as CSV"
          >
            <Download aria-hidden="true" className="size-4" />
            Export enrolments
          </a>
        </Button>
      ) : null}
      {mayReadAttendance ? (
        <Button variant="secondary" size="sm" asChild>
          <a
            href={apiUrl(`/courses/${courseId}/attendance/export`)}
            download="attendance.csv"
            aria-label="Export the attendance register as CSV"
          >
            <Download aria-hidden="true" className="size-4" />
            Export attendance
          </a>
        </Button>
      ) : null}
    </div>
  );
}
