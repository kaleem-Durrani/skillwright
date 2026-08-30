import { expect, test } from '@playwright/test';
import type { UserDetail } from '@skillwright/shared/schema';
import {
  SEED_BULK_PASSWORD,
  apiFromPage,
  openAs,
  openSignedOut,
  seededStudents,
  settle,
  signIn,
  type ApiAnswer,
} from './stack.js';

/**
 * GOLDEN PATH 5 (Appendix D): an admin suspends a user, and that user's next request
 * fails mid-session.
 *
 * This is lesson 27 with a browser attached. The server has always been right — the
 * suspension destroys every session row and the next authenticated request is 401 —
 * and the client was wrong in a way no server test could see: the route guard read
 * the session through `ensureQueryData`, that cache entry was still inside its
 * `staleTime`, and so a suspended student kept navigating a fully painted app
 * indefinitely, issuing NO requests at all. The fix is a QueryCache `onError` that
 * recognises the refusal, drops the session entry and re-runs the guards.
 *
 * WHICH IS WHY THE NAVIGATION BELOW IS A CLICK, NOT A `page.goto`. A full page load
 * re-bootstraps the SPA, asks `/auth/session` from cold and redirects correctly even
 * with the bug present — so a spec written with `goto` would pass against the exact
 * defect this exists to catch. The only version of this test that can fail for the
 * real reason is an in-app link click.
 *
 * WHO GETS SUSPENDED, AND WHY IT IS NOT A DEMO ACCOUNT. The victim is one of the
 * seed's 79 ordinary students, discovered at run time. Suspending `demo.student`
 * would put the account the README tells strangers to sign in with, and that
 * `pnpm screenshots` drives, one killed process away from being locked out. An
 * anonymous seeded student has two independent recoveries: the `finally` below
 * reinstates them (both verbs are idempotent, users.service.ts), and `pnpm db:seed`
 * writes `status` in its update block, so a reseed clears it too.
 */

test('an admin suspends a signed-in user, and the app stops trusting its cache', async ({
  browser,
}) => {
  const adminPage = await openAs(browser, 'admin');
  const victimPage = await openSignedOut(browser);

  let victim: UserDetail | null = null;
  let reinstatement: ApiAnswer<UserDetail> | null = null;

  try {
    // The `victim` half of the seeded students — disjoint from the half
    // enrollment.spec.ts draws its applicant from, so the two specs can run in
    // parallel workers without one suspending the other's applicant mid-enrolment.
    const [target] = await seededStudents(adminPage, 'victim');
    if (target === undefined) {
      throw new Error(
        'The seed holds no ACTIVE non-demo student to suspend. Re-run `pnpm db:seed`.',
      );
    }
    // Recorded for the `finally` the moment it is known, so a failure anywhere below
    // still reaches the reinstatement.
    victim = target;

    await test.step('the victim signs in and is inside the app', async () => {
      // seed.ts hashes one BULK_PASSWORD for every account that is not one of the
      // three demo rows. This login lands on a different account most runs, so it
      // never accumulates against one account's rate-limit bucket.
      await signIn(victimPage, target.email, SEED_BULK_PASSWORD);
      // Scoped to the header: the same label is also printed in the dashboard's
      // account card, and an unscoped query fails as a strict-mode violation.
      await expect(
        victimPage.getByRole('banner').getByText('Student workspace', { exact: true }),
      ).toBeVisible();
    });

    await test.step('the admin suspends them', async () => {
      await adminPage.goto(`/admin/users?q=${encodeURIComponent(target.email)}`);
      await settle(adminPage);

      const row = adminPage
        .getByRole('table', { name: 'User accounts' })
        .getByRole('row')
        .filter({ hasText: target.email });
      await expect(row).toHaveCount(1);

      await row.getByRole('button', { name: `Actions for ${target.name}` }).click();
      await adminPage.getByRole('menuitem', { name: 'Suspend account' }).click();
      // The dialog's confirm carries the same words as the menu item it came from;
      // the ROLE is what separates them, and the menu has closed by now anyway.
      await adminPage.getByRole('button', { name: 'Suspend account' }).click();

      await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
    });

    await test.step('the victim navigates, and lands on the login screen', async () => {
      await victimPage
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Courses' })
        .click();

      await victimPage.waitForURL('**/login**');
      await expect(victimPage.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    });

    await test.step('and the server agrees, asked directly', async () => {
      /*
       * A second, independent direction on the same fact — lesson 26's rule, after
       * two UI defects were reported and withdrawn in one session. The redirect above
       * proves the CLIENT stopped believing in the session; this proves the session
       * is actually gone. 401 rather than 403: `suspend()` destroys every session row
       * immediately (users.service.ts), so by now there is no session left to be
       * refused as suspended.
       */
      const answer = await apiFromPage<UserDetail>(victimPage, 'GET', '/users/me');
      expect(answer.status).toBe(401);
    });
  } finally {
    if (victim !== null) {
      reinstatement = await apiFromPage<UserDetail>(
        adminPage,
        'POST',
        `/users/${victim.id}/reinstate`,
        {},
      );
    }
    await adminPage.context().close();
    await victimPage.context().close();
  }

  /*
   * Outside the `finally` so a failure above arrives as itself rather than as a
   * cleanup error. Asserting the RETURNED STATUS, not just the HTTP code: reinstate
   * answers 200 for an account it left untouched as well as one it changed
   * (idempotent by design), so the row's own `status` is the only thing that proves
   * the seeded database is back the way it was found.
   */
  expect(reinstatement?.status, 'the reinstatement request itself failed').toBe(200);
  expect(
    reinstatement?.body?.status,
    'a seeded student has been left SUSPENDED in the shared database',
  ).toBe('ACTIVE');
});
