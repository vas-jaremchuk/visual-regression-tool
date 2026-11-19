import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against local Supabase (`pnpm db:start && pnpm db:reset`). Keys come from
 * `supabase status`; services the web app does not call yet (Cloudflare, Resend) get fakes.
 */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const statusOutput = execSync('pnpm exec supabase status -o json', {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const status = JSON.parse(
  statusOutput.slice(statusOutput.indexOf('{'), statusOutput.lastIndexOf('}') + 1),
) as Record<string, string>;

const APP_URL = 'http://127.0.0.1:3000';

const e2eEnv = {
  APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY!,
  MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL!,
  CF_ACCOUNT_ID: 'e2e-account',
  CF_API_TOKEN: 'e2e-token',
  R2_ACCESS_KEY_ID: 'e2e-access-key',
  R2_SECRET_ACCESS_KEY: 'e2e-secret-key',
  WORKER_URL: 'http://127.0.0.1:8787',
  WORKER_SHARED_SECRET: 'e2e-worker-shared-secret-0123456789abcdef',
  SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  RESEND_API_KEY: 're_e2e',
  EMAIL_FROM: 'Visual Regression <vrt@example.com>',
};
Object.assign(process.env, e2eEnv);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start --hostname 127.0.0.1 --port 3000',
    url: `${APP_URL}/login`,
    env: e2eEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
