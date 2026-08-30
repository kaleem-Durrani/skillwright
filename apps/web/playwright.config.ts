import { defineConfig, devices } from '@playwright/test';

/**
 * The mobile project runs FIRST and is not optional.
 *
 * A suite that only runs at 1280px certifies the enhancement and never the
 * baseline, which is the exact inversion of how this app is built.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Two reporters under CI, not one. 'github' writes the inline annotations; the
  // HTML report is what the workflow uploads on failure, and a single 'github'
  // reporter replaces the default list entirely — so playwright-report/ was never
  // written and the artifact promised a trace viewer that did not exist.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
