import { expect, test } from '@playwright/test';

/**
 * The mobile-first contract, asserted rather than asserted-to.
 *
 * These run against the real build in the `mobile` project first, which is the
 * whole point: the baseline is what ships to a student on a phone in a workshop.
 */

test.describe('mobile-first shell', () => {
  test('the document never scrolls sideways at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/login');

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('every interactive control meets the 44px touch target', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/login');

    const controls = page.locator('button:visible, a:visible, input:visible');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const box = await controls.nth(index).boundingBox();
      if (!box) continue;
      // Inline text links inside a paragraph are exempt: they inherit the line
      // box, and padding them to 44px would break the paragraph.
      const isInlineLink = await controls
        .nth(index)
        .evaluate(
          (element) => element.tagName === 'A' && getComputedStyle(element).display === 'inline',
        );
      if (isInlineLink) continue;
      expect.soft(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('the theme is applied before the first paint', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sw.theme', 'dark'));
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the design gallery renders both themes', async ({ page }) => {
    await page.goto('/design');
    await expect(page.locator('[data-theme-preview="light"]')).toBeVisible();
    await expect(page.locator('[data-theme-preview="dark"]')).toBeVisible();
  });
});

test.describe('login', () => {
  test('offers the three demo accounts', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /Continue as Student/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue as Teacher/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue as Admin/i })).toBeVisible();
  });

  test('validates before it ever reaches the network', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your email address')).toBeVisible();
  });
});
