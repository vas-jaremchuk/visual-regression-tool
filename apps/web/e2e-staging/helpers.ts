import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import { parseEnv, stagingEnv } from '@vrt/shared';

export const env = parseEnv(stagingEnv, process.env, 'staging suite');

/** Editor and viewer are plus-aliases of the admin mailbox, so notification emails land there. */
function alias(tag: string) {
  const [local, domain] = env.STAGING_ADMIN_EMAIL.split('@');
  return `${local}+${tag}@${domain}`;
}
export const ADMIN = env.STAGING_ADMIN_EMAIL;
export const EDITOR = alias('vrt-editor');
export const VIEWER = alias('vrt-viewer');

/** Service-role client of the staging Supabase project: setup and outcome checks only. */
export const staging = createClient<Database>(
  env.STAGING_SUPABASE_URL,
  env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function ensureUser(email: string): Promise<string> {
  const { data: profile } = await staging
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (profile) return profile.id;
  const { data, error } = await staging.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

/**
 * Signs `email` in without reading a mailbox: a magic-link token from the admin API, completed
 * through the app's own `/auth/callback` (token_hash flow), which also applies the disabled check.
 */
export async function signIn(browser: Browser, email: string, path = '/'): Promise<Page> {
  const { data, error } = await staging.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const page = await (await browser.newContext()).newPage();
  const callback = new URL('/auth/callback', env.STAGING_APP_URL);
  callback.searchParams.set('token_hash', data.properties.hashed_token);
  callback.searchParams.set('type', 'magiclink');
  callback.searchParams.set('next', path);
  await page.goto(callback.toString());
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Polls `read` until it returns a value `done` accepts (never null); real jobs take minutes. */
export async function waitFor<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 15 * 60_000,
): Promise<NonNullable<T>> {
  let last: T | undefined;
  await expect
    .poll(
      async () => {
        last = await read();
        return done(last);
      },
      { message: what, timeout, intervals: [5_000] },
    )
    .toBe(true);
  return last as NonNullable<T>;
}

const workerDir = fileURLToPath(new URL('../../worker', import.meta.url));

/**
 * Switches the fixture site Worker to `version` by redeploying it with `SITE_VERSION`
 * (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID), then waits until it serves it.
 */
export async function switchFixtureSite(version: 'v1' | 'v2') {
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'deploy',
      '--config',
      'wrangler.fixture-site.jsonc',
      '--var',
      `SITE_VERSION:${version}`,
    ],
    { cwd: workerDir, stdio: 'inherit' },
  );
  await waitFor(
    `fixture site serves ${version}`,
    async () => {
      const res = await fetch(new URL('/__fixture/version', env.STAGING_FIXTURE_SITE_URL), {
        cache: 'no-store',
      }).catch(() => null);
      return res?.ok ? ((await res.json()) as { version: string }).version : null;
    },
    (served) => served === version,
    2 * 60_000,
  );
}

export async function projectBySlug(slug: string) {
  const { data, error } = await staging
    .from('projects')
    .select('id, baseline_run_id')
    .eq('slug', slug)
    .single();
  if (error) throw error;
  return data;
}

export async function runByLabel(projectId: string, label: string) {
  const { data, error } = await staging
    .from('runs')
    .select('id, label, status')
    .eq('project_id', projectId)
    .eq('label', label)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Waits until the run labelled `label` has finished and returns it. */
export function waitForRun(projectId: string, label: string) {
  return waitFor(
    `run ${label} finished`,
    () => runByLabel(projectId, label),
    (run) => !!run && !['queued', 'running'].includes(run.status),
  );
}

export async function comparisonByLabel(projectId: string, label: string) {
  const { data, error } = await staging
    .from('comparisons')
    .select('id, status, workflow_id')
    .eq('project_id', projectId)
    .eq('label', label)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Waits until the comparison `label` has finished; for a re-diff, under a workflow other than `notWorkflow`. */
export function waitForComparison(projectId: string, label: string, notWorkflow?: string | null) {
  return waitFor(
    `comparison ${label} finished`,
    () => comparisonByLabel(projectId, label),
    (cmp) =>
      !!cmp &&
      !['queued', 'running'].includes(cmp.status) &&
      (notWorkflow === undefined || cmp.workflow_id !== notWorkflow),
  );
}

/** Run labels are the last path segment of the run page (`/p/<slug>/runs/<label>`). */
export function labelFromUrl(page: Page): string {
  return decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
}
