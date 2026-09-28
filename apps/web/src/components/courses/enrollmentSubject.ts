import { subject, type PolicySubject } from '@/lib/policy';
import type { CourseDetail, EnrollmentDto } from '@/lib/types';

/**
 * The policy Subject for ONE enrolment row, mirroring the server's projection
 * field for field — `loadEnrollmentSubject` (enrollments.service.ts:109-139).
 *
 * It exists as a shared function rather than a projection repeated at each call
 * site because every rule these two screens ask is SUBJECT-DEPENDENT and a
 * wrong key is a silent permanent denial, not a type error:
 *
 *   - `studentId`, never `student.id` spread under another name — `isEnrolledStudent`
 *     reads it (combinators.ts:75-79) and it is what separates "this is my seat"
 *     from "this is someone else's row on the roster".
 *   - `courseTeacherId`, never `teacher.id` — `ownsCourse` reads the former
 *     (combinators.ts:55-59), which is what gates `enrollment:complete` and
 *     `enrollment:uncomplete` for a TEACHER.
 *
 * `enrollmentStatus` is deliberately ABSENT, exactly as the server loader has it:
 * actor.ts says that field is the REQUESTING actor's status in the relevant
 * course and not the status of some arbitrary row, and no rule either verb reads
 * consults it. Adding it here because the DTO happens to carry `status` would be
 * the one misuse the field's own comment names.
 *
 * The DTO nests the offering and the offering nests the course, so a `subject({...row})`
 * spread would contribute only `id` and the student summary — every field the rules
 * read would be absent, and every gate would deny. Named explicitly, per the
 * remaining hole LESSONS-LEARNED #18 records about spreads.
 */
export function enrollmentSubject(enrollment: EnrollmentDto, course: CourseDetail): PolicySubject {
  return subject({
    id: enrollment.id,
    studentId: enrollment.student.id,
    // The offering's course, not the row's own summary — same value, read once
    // here so the two cannot disagree when Phase 10 renames one of them.
    courseId: enrollment.course.id,
    courseTeacherId: course.teacher.id,
    publishedAt: course.publishedAt,
  });
}
