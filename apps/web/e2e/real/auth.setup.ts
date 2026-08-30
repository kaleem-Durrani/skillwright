import { expect, test as setup } from '@playwright/test';
import { DEMO_EMAIL, DEMO_PASSWORD, signIn, storageStateFor, type DemoRole } from './stack.js';

/**
 * Golden path 1's second half — `login` — and the dependency every other spec in
 * this project is built on.
 *
 * It is a setup project rather than a spec because of the rate limit, not because
 * signing in is uninteresting. `RATE_LIMIT_AUTH_ACCOUNT_MAX` is 10 logins per 15
 * minutes per account (ratelimit.plugin.ts), so a suite that signed in per test
 * would start answering 429 on its second or third run of an afternoon — and a
 * suite that flakes on the developer's third run is a suite people stop running.
 * One login per role, saved as a `storageState` the specs reuse, is what keeps the
 * whole project at four logins across four different accounts.
 *
 * Running here also makes the failure legible: if the login form, the session
 * cookie, the `/auth/session` bootstrap or the router guard is broken, THIS fails
 * and everything downstream reports "setup failed" — instead of three specs each
 * failing on a different missing button.
 *
 * NOT covered here, deliberately: `register` and `verify`, the first two thirds of
 * golden path 1. Both write a user row that nothing can delete afterwards (the API
 * has no user-delete route at all), and `verify` needs the code out of the mail
 * Mailpit caught. The reasoning is written up in the task notes rather than faked
 * with a test that skips the verification step.
 */

/**
 * The workspace chip in the header (`nav.ts` WORKSPACE_LABEL, rendered by
 * AppShell). Asserting it — rather than just "we reached /dashboard" — is what
 * proves the session the cookie carries is the account we typed, and that the shell
 * read a real `/auth/session` answer rather than rendering from an empty cache.
 */
const WORKSPACE_LABEL: Record<DemoRole, string> = {
  student: 'Student workspace',
  teacher: 'Teaching workspace',
  admin: 'Admin workspace',
};

for (const role of Object.keys(WORKSPACE_LABEL) as DemoRole[]) {
  setup(`sign in as the demo ${role} and bank the session`, async ({ page }) => {
    await signIn(page, DEMO_EMAIL[role], DEMO_PASSWORD);

    /*
     * Scoped to the banner. The label appears twice on a signed-in dashboard — the
     * header's workspace chip and again inside the account card in `#main-content` —
     * and an unscoped query is a strict-mode violation, which fails as "resolved to 2
     * elements" rather than as anything about the session. The header chip is the one
     * that is on every screen, so it is the one worth asserting.
     */
    const shell = page.getByRole('banner');
    await expect(shell.getByText(WORKSPACE_LABEL[role], { exact: true })).toBeVisible();

    /*
     * The "Demo" badge renders beside it when `provenance === 'DEMO'` (session.ts),
     * which is the one-click POST /auth/demo route rather than a password login.
     * Asserting its ABSENCE pins the thing this setup is for: these sessions must
     * come from the credential form. A DEMO session is refused `user:suspend`
     * outright by DEMO_DENIED (can.ts), so a well-meaning "just click Continue as
     * Admin, it is faster" would leave suspension.spec.ts failing with a policy
     * denial that reads like a product bug.
     */
    await expect(shell.getByText('Demo', { exact: true })).toHaveCount(0);

    await page.context().storageState({ path: storageStateFor(role) });
  });
}
