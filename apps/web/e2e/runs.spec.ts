import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  adminClient,
  auditEntries,
  ensureUser,
  resetAuditWindow,
  setMembership,
} from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { EDITOR, VIEWER } from './fixtures';

/** Project with a seeded snapshot; the worker is a local stub on `WORKER_URL`. */
const PROJECT = { slug: 'e2e-runs-site', name: 'E2E runs site' };
const BASE = 'https://www.example.com';
const URLS = [`${BASE}/`, `${BASE}/about`, `${BASE}/contact`];

/**
 * Worker stub (09 §2): accepts capture start and cancel. Items are advanced by the test through
 * the service role, the way the capture consumer writes progress (06 §7).
 */
let worker: Server;
const started: string[] = [];

test.beforeAll(async () => {
  const port = Number(new URL(process.env.WORKER_URL!).port);
  worker = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/jobs/capture') {
        const { runId } = JSON.parse(body) as { runId: string };
        started.push(runId);
        res.end(JSON.stringify({ workflowId: `wf-${runId}` }));
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/jobs/capture/')) {
        res.statusCode = 202;
        res.end('{}');
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => worker.listen(port, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => worker.close(resolve));
  await deleteProject();
});

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

let projectId: string;

test.beforeEach(async () => {
  resetAuditWindow();
  started.length = 0;
  await deleteProject();
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: `${BASE}/sitemap.xml`,
      r2_bucket: 'vrt-e2e-runs-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  projectId = data.id;
  const { error: viewportError } = await supabase
    .from('viewports')
    .insert({ project_id: projectId, slug: 'desktop', width: 1280, height: 800, sort_order: 0 });
  if (viewportError) throw viewportError;
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');

  const now = new Date().toISOString();
  const { data: snapshot, error: snapshotError } = await supabase
    .from('sitemap_snapshots')
    .insert({
      project_id: projectId,
      status: 'completed',
      source_url: `${BASE}/sitemap.xml`,
      child_sitemaps: 1,
      url_count: URLS.length,
      created_at: now,
      finished_at: now,
    })
    .select('id')
    .single();
  if (snapshotError) throw snapshotError;
  const { error: urlsError } = await supabase.from('sitemap_urls').insert(
    URLS.map((url) => ({
      snapshot_id: snapshot.id,
      url,
      kind: 'page' as const,
      http_status: 200,
      included: true,
      source: 'sitemap',
    })),
  );
  if (urlsError) throw urlsError;
});

/** What the capture consumer does after a batch: item rows, then `refresh_run_counts`. */
async function advance(runId: string, url: string, status: 'done' | 'failed') {
  const supabase = adminClient();
  const { error } = await supabase
    .from('run_items')
    .update({
      status,
      error: status === 'failed' ? 'Navigation timeout of 30000 ms exceeded' : null,
      width: status === 'done' ? 1280 : null,
      height: status === 'done' ? 2400 : null,
      finished_at: new Date().toISOString(),
    })
    .eq('run_id', runId)
    .eq('url', url);
  if (error) throw error;
  const { error: rpcError } = await supabase.rpc('refresh_run_counts', { p_run_id: runId });
  if (rpcError) throw rpcError;
}

async function setRunStatus(runId: string, status: 'running' | 'completed_with_errors') {
  const now = new Date().toISOString();
  const { error } = await adminClient()
    .from('runs')
    .update(status === 'running' ? { status, started_at: now } : { status, finished_at: now })
    .eq('id', runId);
  if (error) throw error;
}

test('editor starts a run and sees its progress update without reload', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}/runs`);
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No runs yet' })).toBeVisible();

  await page.getByRole('button', { name: 'New run' }).click();
  const dialog = page.getByRole('dialog', { name: 'New run' });
  await expect(dialog.getByRole('checkbox', { name: /desktop/ })).toBeChecked();
  await expect(dialog.getByRole('status', { name: 'Estimate' })).toContainText('3 items');
  await dialog.getByRole('button', { name: 'Dry run' }).click();
  await expect(dialog.getByRole('table')).toContainText(`${BASE}/contact`);
  await dialog.getByLabel('Note').fill('before the theme update');
  await dialog.getByRole('button', { name: 'Start run' }).click();

  await expect(page).toHaveURL(/\/runs\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  await expect(page.getByText('before the theme update')).toBeVisible();
  expect(started).toHaveLength(1);
  const runId = started[0]!;
  expect(await auditEntries('run.start', { runId })).toHaveLength(1);

  const counts = page.getByTestId('run-counts');
  // Realtime: the page must not navigate or reload while items advance.
  await page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));

  // The workflow's first poll marks the run running and refreshes its counts.
  await setRunStatus(runId, 'running');
  await adminClient().rpc('refresh_run_counts', { p_run_id: runId });
  await expect(counts).toHaveText('0 done · 0 failed · 3 pending · 3 items');
  await advance(runId, `${BASE}/`, 'done');
  await expect(counts).toHaveText('1 done · 0 failed · 2 pending · 3 items');
  await advance(runId, `${BASE}/about`, 'failed');
  await expect(counts).toHaveText('1 done · 1 failed · 1 pending · 3 items');
  await expect(page.getByText(/ETA: ≈/)).toBeVisible();

  const activeJobs = page.getByRole('button', { name: '1 active job' });
  await expect(activeJobs).toBeVisible();

  await advance(runId, `${BASE}/contact`, 'done');
  await setRunStatus(runId, 'completed_with_errors');
  await expect(counts).toHaveText('2 done · 1 failed · 0 pending · 3 items');
  await expect(page.getByRole('region', { name: 'Run progress' })).toContainText(
    'completed with errors',
  );
  await expect(page.getByRole('button', { name: 'No active jobs' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { marker?: boolean }).marker)).toBe(true);

  // Refreshed by the status change: items, failures and actions of the finished run.
  await expect(page.getByRole('button', { name: 'Retry failed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Compare with…' })).toBeVisible();
  await page.getByRole('link', { name: /^Failures/ }).click();
  await expect(
    page.getByRole('region', { name: 'Navigation timeout of 30000 ms exceeded' }),
  ).toContainText(`${BASE}/about`);
  await page.getByRole('link', { name: 'Settings used' }).click();
  await expect(page.getByText('"scope": "all"')).toBeVisible();

  await page.getByRole('link', { name: 'Runs', exact: true }).first().click();
  const row = page.getByRole('row', { name: /before the theme update/ });
  await expect(row).toContainText('completed with errors');
  await expect(row).toContainText('2/3');
});

test('viewer sees runs without actions and the API refuses viewer actions', async ({ page }) => {
  const supabase = adminClient();
  const { data: run, error } = await supabase
    .from('runs')
    .insert({
      project_id: projectId,
      label: '2026-11-22_09-00-00',
      status: 'running',
      viewport_slugs: ['desktop'],
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  const { error: itemsError } = await supabase.from('run_items').insert(
    URLS.map((url, i) => ({
      run_id: run.id,
      url,
      kind: 'page' as const,
      viewport_slug: 'desktop',
      filename: `page-${i}`,
    })),
  );
  if (itemsError) throw itemsError;
  await supabase.rpc('refresh_run_counts', { p_run_id: run.id });

  await signInWithMagicLink(page, VIEWER, `/p/${PROJECT.slug}/runs`);
  await expect(
    page.getByRole('table').getByRole('link', { name: '2026-11-22_09-00-00' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'New run' })).toHaveCount(0);

  await page.getByRole('table').getByRole('link', { name: '2026-11-22_09-00-00' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2026-11-22_09-00-00');
  await expect(page.getByTestId('run-counts')).toHaveText(
    '0 done · 0 failed · 3 pending · 3 items',
  );
  for (const name of ['Cancel', 'Retry failed', 'Set as baseline', 'Delete']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Compare with…' })).toHaveCount(0);
  await expect(page.getByRole('table')).toContainText(`${BASE}/about`);

  const post = (path: string, data: unknown = {}) => page.request.post(path, { data });
  expect((await post(`/api/runs/${run.id}/cancel`)).status()).toBe(403);
  expect((await post(`/api/runs/${run.id}/retry-failed`)).status()).toBe(403);
  expect((await post(`/api/runs/${run.id}/baseline`)).status()).toBe(403);
  const snapshot = await supabase
    .from('sitemap_snapshots')
    .select('id')
    .eq('project_id', projectId)
    .single();
  expect(
    (
      await post(`/api/projects/${projectId}/runs`, {
        snapshotId: snapshot.data!.id,
        viewports: ['desktop'],
        dryRun: true,
      })
    ).status(),
  ).toBe(403);
  expect(started).toHaveLength(0);
});
