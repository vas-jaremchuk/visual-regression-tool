import { defineConfig, devices } from '@playwright/test';
import { parseEnv, stagingEnv } from '@vrt/shared';

/**
 * Release acceptance (specification/11-testing.md §4) against a deployed staging stack: real web
 * app, worker, Cloudflare and staging Supabase, with the fixture site Worker as the site under
 * test. Manual trigger only (`.github/workflows/staging-acceptance.yml`); never production.
 * Variables: `e2e-staging/.env.example`.
 */
const env = parseEnv(stagingEnv, process.env, 'staging suite');

export default defineConfig({
  testDir: './e2e-staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // Real captures and comparisons take minutes.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: env.STAGING_APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
