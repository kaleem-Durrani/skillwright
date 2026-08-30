import { expect, test } from '@playwright/test';
import type {
  CourseListItem,
  Paginated,
  ResourceDto,
  UserDetail,
} from '@skillwright/shared/schema';
import { apiFromPage, apiOk, openAs, settle } from './stack.js';

/**
 * GOLDEN PATH 4 (Appendix D): teacher A attempts to create a resource in teacher B's
 * course, and is refused 403.
 *
 * Two halves, and the second is the one that matters. The UI half asserts that the
 * affordances a non-owner must not have are absent; the API half asserts that the
 * server refuses the request anyway. A suite that only checked the buttons would
 * certify a product whose entire authorization story is "we did not render the
 * button", which is what `curl` is for — and this repository has already shipped one
 * leak of exactly that shape (lesson 31: four resources served to an anonymous
 * `curl` while invisible in the UI to every signed-in user).
 *
 * THE POSITIVE CONTROL IS NOT DECORATION. Every "this control is absent" assertion
 * is also satisfied by a renamed button, a moved tab, or a page that failed to load,
 * so each one is made twice: once on a colleague's course where it must be absent,
 * once on the teacher's own where it must be present. Without the second half this
 * file would keep passing after someone renamed "Add a resource".
 *
 * Read-only: it creates nothing and changes nothing, because the one write it
 * attempts is the one the server is supposed to refuse.
 */

test('a teacher gets no controls, and no 201, on a colleague’s course', async ({ browser }) => {
  const page = await openAs(browser, 'teacher');

  try {
    const teacher = await apiOk<UserDetail>(page, 'GET', '/users/me');
    const catalogue = await apiOk<Paginated<CourseListItem>>(page, 'GET', '/courses?limit=100');

    /*
     * A TEACHER's catalogue is already narrowed server-side to published courses plus
     * their own (`visibilityWhere`, courses.service.ts), so both of these come out of
     * one list. `publishedAt !== null` on the colleague's course is deliberate: the
     * point of this path is that a teacher may READ a published course they do not
     * own — `course:read` is `or(isPublished, ownsCourse)` — and is refused only when
     * they try to write to it. Picking a draft would confuse a policy narrowing with
     * a missing row.
     */
    const theirs = catalogue.data.find(
      (course) => course.teacher.id !== teacher.id && course.publishedAt !== null,
    );
    const mine = catalogue.data.find(
      (course) => course.teacher.id === teacher.id && course.publishedAt !== null,
    );
    if (theirs === undefined || mine === undefined) {
      throw new Error(
        `The seed must hold at least one published course taught by ${teacher.email} and one ` +
          'taught by somebody else for this path to mean anything. Re-run `pnpm db:seed`.',
      );
    }

    await test.step('their course reads, and offers nothing', async () => {
      await page.goto(`/courses/${theirs.id}`);
      await settle(page);

      // Reading it is allowed and IS the point: `isPublished` is doing its job here,
      // and a 403 on this line would be the policy being too narrow, not too wide.
      await expect(page.getByRole('heading', { name: theirs.name, level: 1 })).toBeVisible();

      await expect(page.getByRole('button', { name: 'Add a resource' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit course' })).toHaveCount(0);
      // `enrollment:read` for a TEACHER is `ownsCourse`, so a colleague's roster —
      // the names and decisions of other people's students — is not a tab they have.
      await expect(page.getByRole('tab', { name: 'Students' })).toHaveCount(0);
    });

    await test.step('their course refuses the write, naming the rule', async () => {
      /*
       * The body is VALID on purpose. Body validation runs in `preValidation`, before
       * the policy `preHandler` (lesson 12), so a malformed body would answer 422 and
       * this test would pass for having sent nonsense rather than for being refused —
       * the exact false pass lesson 24 describes. `type: 'LINK'` with an
       * `externalUrl` and no `uploadId` satisfies `exactlyOneSource`, so the only
       * thing left to fail is the policy.
       */
      const refusal = await apiFromPage<ResourceDto>(page, 'POST', '/resources', {
        courseId: theirs.id,
        title: 'e2e cross-teacher probe',
        type: 'LINK',
        externalUrl: 'https://example.com/not-your-course',
        isPublic: false,
      });

      expect(refusal.status).toBe(403);
      expect(refusal.code).toBe('FORBIDDEN');
      /*
       * The rule name, not just the status. `forbidden(detail, rule)` appends
       * `(rule: TEACHER:ownsCourse)` (errors.ts), and that string is the difference
       * between "the policy refused this for the reason it exists for" and "something
       * else in the stack answered 403" — the CSRF hook, a suspended account and an
       * MFA-pending session all also answer 403 on this route.
       */
      expect(refusal.detail).toContain('TEACHER:ownsCourse');
    });

    await test.step('the same teacher, on their own course, gets all of it', async () => {
      await page.goto(`/courses/${mine.id}`);
      await settle(page);

      await expect(page.getByRole('heading', { name: mine.name, level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add a resource' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit course' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Students' })).toBeVisible();
    });
  } finally {
    await page.context().close();
  }
});
