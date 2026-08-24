/**
 * Client-side readings of the Phase 9 offering model — the small derivations every
 * course surface needs now that seats and dates live per intake.
 *
 * Deliberately THIN. Everything numeric (`seatsRemaining`, `isFull`,
 * `workshopSeatsRemaining`) is served pre-computed on `courseOfferingSchema`
 * (course.ts:38-52) precisely so the SPA never redoes capacity arithmetic; what is
 * left here is only SELECTION (which intake a screen names) and PRESENTATION
 * (how its dates read), neither of which the server can decide for a viewport.
 */
import { formatDate } from '@/lib/format';
import type { EnrollmentStatusValue, ViewerCourseOffering } from '@/lib/types';

/**
 * The soonest intake that still has seats, or undefined when every intake is full —
 * or when there are no intakes at all.
 *
 * WHY no sort: the wire contract orders offerings soonest-start FIRST
 * (course.ts:112-117, mirrored by courses.service.ts's orderBy), so "first open" IS
 * "soonest open". Re-sorting here would fork the ordering the detail page renders,
 * and two answers to "which intake is next" is one answer too many.
 *
 * This is the UI half of the catalogue's `hasSeats=true` filter
 * (listCoursesQuerySchema): a card shows this intake's seats, and shows nothing when
 * it answers undefined.
 */
export function soonestOpenOffering(
  offerings: readonly ViewerCourseOffering[],
): ViewerCourseOffering | undefined {
  return offerings.find((offering) => !offering.isFull);
}

/**
 * The viewer's COURSE-level enrolment status, derived from the per-intake statuses
 * the payload carries since Phase 9.
 *
 * WHY derive rather than invent: the server resolves the same question in
 * `loadCourseSubjectForActor` as APPROVED-on-any-live-intake, else the most recent
 * row. Only `enrolledApproved` ever reads this field on the policy side
 * (combinators.ts:62-65), so the derivation below is exactly faithful where it
 * decides anything: any APPROVED seat wins. For the non-APPROVED remainder it falls
 * back to the first intake that carries a status — an approximation of "most
 * recent", safe because no rule distinguishes PENDING from REJECTED here; the
 * per-intake chips in the offerings section are where those states actually show.
 */
export function courseViewerStatus(
  offerings: readonly ViewerCourseOffering[],
): EnrollmentStatusValue | null {
  if (offerings.some((offering) => offering.viewerEnrollmentStatus === 'APPROVED')) {
    return 'APPROVED';
  }
  return (
    offerings.find((offering) => offering.viewerEnrollmentStatus !== null)
      ?.viewerEnrollmentStatus ?? null
  );
}

/**
 * One intake's dates as a reader reads them: "1 Sep 2026 – 15 Dec 2026", degraded
 * honestly when either end is unset — an intake opened before its timetable was
 * decided must not render "Invalid Date" or a silent dash.
 */
export function formatOfferingDates(offering: {
  startDate: string | null;
  endDate: string | null;
}): string {
  // `formatDate` renders '—' for empty input; here an unset end is a STATE ("no end
  // yet"), not a dash, so each side is formatted only when it exists.
  const start = offering.startDate !== null ? formatDate(offering.startDate) : null;
  const end = offering.endDate !== null ? formatDate(offering.endDate) : null;
  if (start === null && end === null) return 'Dates to be announced';
  if (start === null) return `Until ${end}`;
  if (end === null) return `From ${start}`;
  return `${start} – ${end}`;
}
