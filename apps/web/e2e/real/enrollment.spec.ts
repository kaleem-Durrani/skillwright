import { expect, test } from '@playwright/test';
import type {
  CourseListItem,
  EnrollmentDto,
  Paginated,
  UserDetail,
} from '@skillwright/shared/schema';
import {
  SEED_BULK_PASSWORD,
  apiFromPage,
  apiOk,
  openAs,
  openSignedOut,
  seededStudents,
  settle,
  signIn,
  type ApiAnswer,
} from './stack.js';

/**
 * GOLDEN PATH 2 (docs/rebuild/00-REBUILD-PLAN.md, Appendix D): a student browses,
 * requests enrolment, a teacher approves it, and the seat is the student's.
 *
 * It is the path the product exists for and the one with the most seams in it: two
 * accounts, two browser contexts, a policy decision on each side, a denormalised
 * `approvedCount` maintained inside a SERIALIZABLE transaction (ADR 0006), a
 * notification, and three screens that must agree about one row. Every one of those
 * is covered by an API test in isolation; NONE of them was covered together, through
 * a browser, by anything in this repository.
 *
 * WHY THE APPLICANT IS NOT `demo.student`. A request cannot be un-made: withdrawal
 * moves the row to WITHDRAWN, and the UI shows a status chip instead of the enrol
 * affordance wherever the viewer holds any row at all (CourseOfferings.tsx), so a
 * course this path has used is spent for that student until the next `pnpm db:seed`.
 * The demo teacher owns exactly two of the seed's eighteen courses — teacher index
 * `(dept * 2 + index % 2) % 12`, which is 0 only for the two dept-0 courses at even
 * index — so with the demo student as applicant the whole suite would be runnable
 * once, maybe twice, per reseed. Drawing the applicant from the seeded student body
 * instead gives roughly seventy usable (student, course) pairs, which is the
 * difference between a suite people run locally and a suite people skip. The
 * APPROVER is still the demo teacher: their session is already banked, and it is the
 * teacher's own ownership rule (`ownsCourse`) that decides the approval.
 *
 * WHAT IT MUTATES, AND HOW IT PUTS IT BACK. It creates exactly one enrolment and
 * withdraws it in a `finally`. Withdrawal is a real transition rather than a delete,
 * and `settle()` in enrollments.service.ts releases the seat the approval took, so
 * `approvedCount` returns to its seeded value instead of drifting by one per run —
 * which is what would otherwise turn `pnpm screenshots` into a photograph of a
 * course whose seat count no longer matches the seed. What survives is a WITHDRAWN
 * enrolment and the notifications the two decisions raised: additive rows nothing
 * photographs, and which the next reseed overwrites (the seed upserts every
 * enrolment it owns and rewrites `approvedCount` from its plan).
 */

/** The intake this path drives: the soonest one, which is the row the UI shows first. */
function firstIntakeIsOpen(course: CourseListItem): boolean {
  const [intake] = course.offerings;
  if (intake === undefined) return false;

  return (
    // A draft course cannot accumulate a waiting list (policy.ts `studentSeatRequest`),
    // so an unpublished one would refuse the request for a reason unrelated to seats.
    course.publishedAt !== null &&
    // An unmet rung leaves the button on screen but disabled with the rung named
    // (CourseOfferings.tsx `enrolBlocker`) — a different assertion than this one.
    course.prerequisite === null &&
    !intake.isFull &&
    // Mirrors `enrolBlocker`'s workshop clause exactly: an UNBOUND workshop
    // (`workshopCapacity === null`) blocks nothing, and its remainder is null.
    (intake.workshopCapacity === null || intake.workshopSeatsRemaining !== 0)
  );
}

test('a student requests a seat, the teacher approves it, and every screen agrees', async ({
  browser,
}) => {
  const adminPage = await openAs(browser, 'admin');
  const teacherPage = await openAs(browser, 'teacher');
  const studentPage = await openSignedOut(browser);

  let enrollmentId: string | null = null;
  let withdrawal: ApiAnswer<EnrollmentDto> | null = null;

  try {
    /*
     * The fixture is DISCOVERED, never hard-coded. seed.ts assigns enrolments by
     * shuffling the 80 students with a seeded PRNG (`shuffled(students, ...)`), so
     * who holds a row on what is deterministic but not knowable by reading the file —
     * and an id pasted in here would survive only until someone renamed a course, at
     * which point this spec would fail naming the wrong thing entirely.
     */
    const teacher = await apiOk<UserDetail>(teacherPage, 'GET', '/users/me');
    const owned = await apiOk<Paginated<CourseListItem>>(
      teacherPage,
      'GET',
      `/courses?teacherId=${teacher.id}&limit=100`,
    );
    const applicants = await seededStudents(adminPage, 'applicant');

    let course: CourseListItem | undefined;
    let student: UserDetail | undefined;

    for (const candidate of owned.data.filter(firstIntakeIsOpen)) {
      const [intake] = candidate.offerings;
      if (intake === undefined) continue;

      // An ADMIN sees every row (`visibilityWhere`), so this is the complete set of
      // people who already hold a seat or a decision on THIS intake.
      const taken = await apiOk<Paginated<EnrollmentDto>>(
        adminPage,
        'GET',
        `/enrollments?courseId=${candidate.id}&limit=100`,
      );
      const spoken = new Set(
        taken.data.filter((row) => row.offering.id === intake.id).map((row) => row.student.id),
      );

      student = applicants.find((person) => !spoken.has(person.id));
      if (student !== undefined) {
        course = candidate;
        break;
      }
    }

    if (course === undefined || student === undefined) {
      throw new Error(
        `Every open intake taught by ${teacher.email} is already spoken for by every student in ` +
          'the applicant pool. Re-run `pnpm db:seed`: previous runs leave a WITHDRAWN row behind ' +
          'per run, and enough of them exhaust the pool.',
      );
    }
    const applicant = student;
    const target = course;

    enrollmentId = await test.step('the student signs in and asks for a seat', async () => {
      // seed.ts hashes one BULK_PASSWORD for every account that is not a demo row.
      await signIn(studentPage, applicant.email, SEED_BULK_PASSWORD);

      await studentPage.goto(`/courses/${target.id}`);
      await settle(studentPage);

      /*
       * Scoped to the FIRST intake row rather than the section, and that is what
       * keeps this readable on a course with more than one intake: the seed gives
       * one course a second, future intake, and both rows would otherwise offer a
       * "Request seat" button. Addressing the row by position costs nothing;
       * addressing it by its dates would mean copying `formatOfferingDates` into a
       * test, where it would go stale silently.
       */
      const intake = studentPage
        .getByRole('region', { name: 'Intakes' })
        .getByRole('listitem')
        .first();
      await intake.getByRole('button', { name: 'Request seat' }).click();

      /*
       * The row swaps the affordance for the viewer's own status the moment the
       * mutation's invalidation lands (CourseOfferings.tsx: "The viewer's own answer
       * ON THIS INTAKE outranks any affordance"). Both halves are asserted — a chip
       * that appeared beside a button that stayed would be a page still offering a
       * seat that has already been asked for.
       */
      await expect(intake.getByText('Pending', { exact: true })).toBeVisible();
      await expect(intake.getByRole('button', { name: 'Request seat' })).toHaveCount(0);

      // The student's own rows only: `visibilityWhere` narrows a STUDENT's enrolments
      // to `studentId = actor.id` (enrollments.service.ts).
      const mine = await apiOk<Paginated<EnrollmentDto>>(
        studentPage,
        'GET',
        `/courses/${target.id}/enrollments`,
      );
      const row = mine.data.find((entry) => entry.student.id === applicant.id);
      if (row === undefined) {
        throw new Error(
          'The screen showed "Pending" but the API serves this student no enrolment on the ' +
            'course — the chip is rendering something the server did not store.',
        );
      }
      expect(row.status).toBe('PENDING');
      // Returned rather than assigned from inside the step: a `let` written only
      // within a callback is invisible to the compiler's flow analysis at the
      // `finally` below, and the cleanup would be typed as unreachable.
      return row.id;
    });

    await test.step('it reaches the teacher, who approves it', async () => {
      await teacherPage.goto('/dashboard');
      await settle(teacherPage);

      /*
       * The dashboard queue reads `GET /enrollments?status=PENDING&limit=5`, and the
       * default sort is `requestedAt` DESCENDING (pagination.ts), so a request made
       * seconds ago is first of the five whatever else the teacher is holding.
       * Matching on the student AND the course is what makes this about our row
       * rather than any of the seed's other pending applications.
       */
      const request = teacherPage
        .getByRole('region', { name: 'Enrolment requests' })
        .getByRole('listitem')
        .filter({ hasText: applicant.name })
        .filter({ hasText: target.name });
      await expect(request).toHaveCount(1);

      await request.getByRole('link', { name: 'Review' }).click();
      await teacherPage.waitForURL(`**/courses/${target.id}`);
      await settle(teacherPage);

      await teacherPage.getByRole('tab', { name: 'Students' }).click();

      /*
       * Scoped to the roster table BY ITS CAPTION, not `getByRole('row')` over the
       * page: the attendance register sitting above it is also a table of student
       * rows, and an approved student joins it the moment this click lands. An
       * unscoped row locator would start matching two elements partway through the
       * assertions below — a flake that only appears once the feature works.
       */
      const roster = teacherPage.getByRole('table', { name: 'Enrolled students and requests' });
      const entry = roster.getByRole('row').filter({ hasText: applicant.name });
      await expect(entry).toHaveCount(1);
      await expect(entry.getByText('Pending', { exact: true })).toBeVisible();

      await entry.getByRole('button', { name: 'Approve' }).click();
      await expect(entry.getByText('Approved', { exact: true })).toBeVisible();
    });

    await test.step('the decision reaches the student, and leaves the queue', async () => {
      await studentPage.reload();
      await settle(studentPage);

      await expect(
        studentPage
          .getByRole('region', { name: 'Intakes' })
          .getByRole('listitem')
          .first()
          .getByText('Approved', { exact: true }),
      ).toBeVisible();

      // "Approved and rejected requests move out of this queue automatically" is what
      // the empty state promises the teacher (Dashboard.tsx). Nothing asserted it.
      await teacherPage.goto('/dashboard');
      await settle(teacherPage);
      await expect(
        teacherPage
          .getByRole('region', { name: 'Enrolment requests' })
          .getByRole('listitem')
          .filter({ hasText: applicant.name })
          .filter({ hasText: target.name }),
      ).toHaveCount(0);
    });
  } finally {
    if (enrollmentId !== null) {
      /*
       * `{}` rather than no body at all, deliberately. A bodyless POST reaches the
       * validator as `null` and is the spelling lesson 24 is about — but apps/api
       * already has a regression test that sends exactly that, and cleanup is not the
       * place to re-test it: a cleanup step that fails leaves a seat held in a
       * database everyone else is sharing.
       */
      withdrawal = await apiFromPage<EnrollmentDto>(
        studentPage,
        'POST',
        `/enrollments/${enrollmentId}/withdraw`,
        {},
      );
    }
    await adminPage.context().close();
    await teacherPage.context().close();
    await studentPage.context().close();
  }

  /*
   * Asserted here rather than inside the `finally`, so a failure above arrives as
   * itself: throwing from a finally block replaces whatever sent us into it, and the
   * first failure is always the one worth reading. Reached only when the path above
   * passed, where it is the assertion that the shared database went back as found.
   */
  expect(
    withdrawal?.status,
    'the enrolment was NOT withdrawn — the seeded database has been left holding a seat',
  ).toBe(200);
});
