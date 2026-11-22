import { expect, test, type Page } from '@playwright/test';
import {
  ADMIN,
  comparisonByLabel,
  EDITOR,
  ensureUser,
  env,
  labelFromUrl,
  projectBySlug,
  signIn,
  staging,
  switchFixtureSite,
  VIEWER,
  waitFor,
  waitForComparison,
  waitForRun,
} from './helpers';

/**
 * Release acceptance v1, steps 1–9 (specification/11-testing.md §4), on staging with the fixture
 * site Worker (fixtures/README.md: v1 → v2 changes the home heading, the about image and the PDF,
 * adds /contact/, removes /blog/post-1/; /old-page/ redirects, /missing/ is a 404). The steps
 * build on each other, so they run in order and stop at the first failure.
 */
test.describe.configure({ mode: 'serial' });

const SITE = env.STAGING_FIXTURE_SITE_URL.replace(/\/$/, '');
const PROJECT = { slug: 'vrt-staging-acceptance', name: 'VRT staging acceptance' };
const LEGACY_SLUG = 'vrt-staging-legacy';
const BUCKET = 'vrt-staging-acceptance';

/** Prototype `.env` for the fixture site (F-PROJ-1 import). */
const FIXTURE_ENV = [
  `SITE_NAME="${PROJECT.name}"`,
  `R2_BUCKET=${BUCKET}`,
  `SITEMAP_INDEX=${SITE}/sitemap.xml`,
].join('\n');

const state: {
  projectId?: string;
  v1Run?: string;
  v2Run?: string;
  comparison?: { id: string; label: string };
} = {};

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} missing: an earlier step failed`);
  return value;
}

async function itemsOf(comparisonId: string) {
  const { data, error } = await staging
    .from('comparison_items')
    .select('id, url, kind, viewport_slug, status, review, fp_before, fp_after, redirect_to')
    .eq('comparison_id', comparisonId);
  if (error) throw error;
  return data;
}

async function startRun(page: Page, viewports: string[]) {
  await page.goto(`/p/${PROJECT.slug}/runs`);
  await page.getByRole('button', { name: 'New run' }).click();
  const dialog = page.getByRole('dialog', { name: 'New run' });
  for (const viewport of viewports) {
    await dialog.getByRole('checkbox', { name: new RegExp(viewport) }).check();
  }
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/runs\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  return labelFromUrl(page);
}

async function fetchSitemap(page: Page, slug: string, projectId: string) {
  const since = new Date().toISOString();
  await page.goto(`/p/${slug}/sitemap`);
  await page.getByRole('button', { name: 'Fetch sitemap' }).click();
  const snapshot = await waitFor(
    'sitemap snapshot finished',
    async () =>
      (
        await staging
          .from('sitemap_snapshots')
          .select('id, status, url_count, child_sitemaps, redirect_count')
          .eq('project_id', projectId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
    (row) => !!row && !['queued', 'running'].includes(row.status),
    5 * 60_000,
  );
  expect(snapshot.status).toBe('completed');
  await page.reload();
  return snapshot;
}

async function compare(page: Page, slug: string, projectId: string, before: string, after: string) {
  const runIds = await Promise.all(
    [before, after].map(async (label) => {
      const { data } = await staging
        .from('runs')
        .select('id')
        .eq('project_id', projectId)
        .eq('label', label)
        .single();
      return data!.id;
    }),
  );
  await page.goto(`/p/${slug}/comparisons`);
  await page.getByLabel('Before run').selectOption(runIds[0]!);
  await page.getByLabel('After run').selectOption(runIds[1]!);
  await page.getByRole('button', { name: 'Compare' }).click();
  const label = `${before}_vs_${after}`;
  const cmp = await waitForComparison(projectId, label);
  expect(cmp.status).toBe('completed');
  return { id: cmp.id, label };
}

test.beforeAll(async () => {
  // A clean slate: earlier attempts' projects (runs, comparisons, channels cascade).
  await staging.from('projects').delete().in('slug', [PROJECT.slug, LEGACY_SLUG]);
  const { data: admin } = await staging
    .from('profiles')
    .select('is_platform_admin')
    .eq('email', ADMIN)
    .single();
  expect(admin?.is_platform_admin, `${ADMIN} must be a platform admin (pnpm seed:admin)`).toBe(
    true,
  );
  // Existing accounts are added directly by an invitation, so no invitation email is needed.
  await ensureUser(EDITOR);
  await ensureUser(VIEWER);
  await switchFixtureSite('v1');
});

test('1. admin creates the project from a .env import and invites an editor and a viewer', async ({
  browser,
}) => {
  const page = await signIn(browser, ADMIN, '/projects/new');
  await page.getByRole('button', { name: 'Import from .env' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from .env' });
  await dialog.getByLabel('.env contents').fill(FIXTURE_ENV);
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByRole('table', { name: 'Imported values' })).toContainText(
    `${SITE}/sitemap.xml`,
  );
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await expect(page.getByLabel('R2 bucket')).toHaveValue(BUCKET);
  await page.getByLabel('Slug').fill(PROJECT.slug);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT.slug}$`));
  state.projectId = (await projectBySlug(PROJECT.slug)).id;

  // Step 3 captures desktop and mobile.
  await page.goto(`/p/${PROJECT.slug}/settings/viewports`);
  await page.getByRole('button', { name: 'Add viewport' }).click();
  await page.getByLabel('Preset').selectOption('mobile');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Viewports' }).getByRole('listitem')).toHaveCount(2);

  await page.goto(`/p/${PROJECT.slug}/settings/members`);
  for (const [email, role] of [
    [EDITOR, 'editor'],
    [VIEWER, 'viewer'],
  ] as const) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Role', { exact: true }).selectOption(role);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByText(`${email} already has an account and was added`)).toBeVisible();
  }
  const members = page.getByRole('list', { name: 'Members' });
  await expect(members).toContainText(EDITOR);
  await expect(members).toContainText(VIEWER);

  // Step 5 checks delivery to email (all members) and Slack.
  await page.goto(`/p/${PROJECT.slug}/settings/notifications`);
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await expect(page.getByText('Channel added')).toBeVisible();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByLabel('Type').selectOption('slack');
  await page.getByLabel('Webhook URL').fill(env.STAGING_SLACK_WEBHOOK_URL);
  await page.getByRole('button', { name: 'Add channel' }).click();
  const channels = page.getByRole('list', { name: 'Notification channels' });
  await expect(channels.getByRole('listitem')).toHaveCount(2);
});

test('2. editor fetches the sitemap: redirect excluded, PDF is a file, counts correct', async ({
  browser,
}) => {
  const projectId = need(state.projectId, 'project');
  const page = await signIn(browser, EDITOR, `/p/${PROJECT.slug}/sitemap`);
  const snapshot = await fetchSitemap(page, PROJECT.slug, projectId);
  expect(snapshot).toMatchObject({ child_sitemaps: 2, redirect_count: 1 });

  const { data: urls } = await staging
    .from('sitemap_urls')
    .select('url, kind, http_status, included, redirect_to')
    .eq('snapshot_id', snapshot.id);
  const byUrl = new Map(urls!.map((row) => [row.url, row]));
  expect(byUrl.get(`${SITE}/old-page/`)).toMatchObject({ included: false, http_status: 301 });
  expect(byUrl.get(`${SITE}/docs/brochure.pdf`)).toMatchObject({ kind: 'file', included: true });
  expect(byUrl.get(`${SITE}/missing/`)).toMatchObject({ http_status: 404 });
  // /, /about/ (listed twice), /blog/post-1/?a=1&b=2, /missing/ and the PDF; not the redirect.
  expect(snapshot.url_count).toBe(5);

  const filters = page.getByRole('navigation', { name: 'URL filters' });
  await expect(filters.getByRole('link', { name: 'Redirects 1' })).toBeVisible();
  await filters.getByRole('link', { name: /^Files/ }).click();
  await expect(page.getByRole('table')).toContainText('brochure.pdf');
});

test('3. editor captures desktop and mobile with live progress', async ({ browser }) => {
  const projectId = need(state.projectId, 'project');
  const page = await signIn(browser, EDITOR, `/p/${PROJECT.slug}/runs`);
  const label = await startRun(page, ['desktop', 'mobile']);
  state.v1Run = label;
  // Progress arrives over Realtime: the counts change on the open page without a reload.
  const counts = page.getByTestId('run-counts');
  await expect(counts).toContainText('items');
  await expect(counts).toContainText(/0 pending/, { timeout: 15 * 60_000 });
  const run = await waitForRun(projectId, label);
  expect(run.status).toBe('completed');
  await expect(page.getByRole('region', { name: 'Run progress' })).toContainText('completed');
});

test('4. after switching to v2, the comparison shows every expected difference', async ({
  browser,
}) => {
  const projectId = need(state.projectId, 'project');
  const before = need(state.v1Run, 'v1 run');
  await switchFixtureSite('v2');
  const page = await signIn(browser, EDITOR, `/p/${PROJECT.slug}/sitemap`);
  await fetchSitemap(page, PROJECT.slug, projectId);
  const after = await startRun(page, ['desktop', 'mobile']);
  state.v2Run = after;
  expect((await waitForRun(projectId, after)).status).toBe('completed');

  const cmp = await compare(page, PROJECT.slug, projectId, before, after);
  state.comparison = cmp;
  const items = await itemsOf(cmp.id);
  const status = (url: string, viewport = 'desktop') =>
    items.find(
      (i) => i.url === `${SITE}${url}` && (i.kind === 'file' || i.viewport_slug === viewport),
    )?.status;
  for (const viewport of ['desktop', 'mobile']) {
    expect(status('/', viewport), `heading change (${viewport})`).toBe('changed');
    expect(status('/about/', viewport), `image change (${viewport})`).toBe('changed');
    expect(status('/contact/', viewport), `new page (${viewport})`).toBe('new');
    expect(status('/blog/post-1/?a=1&b=2', viewport), `missing page (${viewport})`).toBe('missing');
  }
  const pdf = items.find((i) => i.url === `${SITE}/docs/brochure.pdf`)!;
  expect(pdf.status).toBe('changed');
  expect(pdf.fp_after).not.toBe(pdf.fp_before);
  expect(items.find((i) => i.url === `${SITE}/old-page/`)?.status).toBe('redirect');

  await page.goto(`/p/${PROJECT.slug}/comparisons/${cmp.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${before} ↔ ${after}`);
  await expect(page.getByRole('heading', { name: /^New pages/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Missing pages/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Redirected pages/ })).toBeVisible();
  await expect(page.getByText('1 file(s) have a different fingerprint')).toBeVisible();
});

test('5. editor approves one, ignores one with a region rule, re-diffs; notifications delivered', async ({
  browser,
}) => {
  const projectId = need(state.projectId, 'project');
  const cmp = need(state.comparison, 'comparison');
  const items = await itemsOf(cmp.id);
  const home = items.find((i) => i.url === `${SITE}/` && i.viewport_slug === 'desktop')!;
  const about = items.find((i) => i.url === `${SITE}/about/` && i.viewport_slug === 'desktop')!;
  const report = `/p/${PROJECT.slug}/comparisons/${cmp.id}`;
  const page = await signIn(browser, EDITOR, `${report}/items/${home.id}`);

  const toolbar = page.getByTestId('review-toolbar');
  await toolbar.getByRole('button', { name: 'Approve' }).click();
  await expect(toolbar.getByRole('button', { name: 'Approve' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Region over the whole first screen of /about/ on desktop: covers the changed image.
  await page.goto(`${report}/items/${about.id}`);
  await page
    .getByRole('group', { name: 'Ignore rule shortcuts' })
    .getByRole('button', { name: 'Ignore region' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Viewport')).toHaveValue('desktop');
  for (const [field, value] of [
    ['x', '0'],
    ['y', '0'],
    ['width', '1280'],
    ['height', '900'],
  ] as const) {
    await dialog.getByLabel(`${field} (px)`).fill(value);
  }
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog).toBeHidden();

  const previous = await comparisonByLabel(projectId, cmp.label);
  await page.goto(report);
  await page.getByRole('button', { name: 'Re-diff' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Re-diff' }).click();
  await expect(page.getByText('Re-diff started')).toBeVisible();
  expect((await waitForComparison(projectId, cmp.label, previous?.workflow_id)).status).toBe(
    'completed',
  );
  const after = await itemsOf(cmp.id);
  expect(
    after.find((i) => i.url === `${SITE}/about/` && i.viewport_slug === 'desktop')?.status,
  ).toBe('unchanged');
  expect(after.find((i) => i.url === `${SITE}/` && i.viewport_slug === 'desktop')?.status).toBe(
    'changed',
  );

  // `comparison_changed` reached both channels (email to all members, Slack).
  const { data: channels } = await staging
    .from('notification_channels')
    .select('id, type')
    .eq('project_id', projectId);
  for (const channel of channels ?? []) {
    await waitFor(
      `${channel.type} notification sent`,
      async () =>
        (
          await staging
            .from('notification_log')
            .select('status')
            .eq('channel_id', channel.id)
            .eq('event', 'comparison_changed')
        ).data ?? [],
      (rows) => rows.some((row) => row.status === 'sent'),
      5 * 60_000,
    );
  }
  expect(channels?.map((c) => c.type).sort()).toEqual(['email', 'slack']);
});

test('6. viewer opens the report; every mutating action is hidden and refused', async ({
  browser,
}) => {
  const projectId = need(state.projectId, 'project');
  const cmp = need(state.comparison, 'comparison');
  const page = await signIn(browser, VIEWER, `/p/${PROJECT.slug}/comparisons/${cmp.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('item-list')).toBeVisible();
  await expect(page.getByTestId('review-toolbar')).toHaveCount(0);
  for (const name of ['Re-diff', 'Share']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await expect(page.getByRole('group', { name: 'Ignore rule shortcuts' })).toHaveCount(0);

  const { data: run } = await staging
    .from('runs')
    .select('id')
    .eq('project_id', projectId)
    .eq('label', need(state.v2Run, 'v2 run'))
    .single();
  const [item] = await itemsOf(cmp.id);
  const post = (path: string, data: unknown = {}) => page.request.post(path, { data });
  for (const [path, data] of [
    [`/api/comparisons/${cmp.id}/review`, { itemIds: [item!.id], review: 'approved' }],
    [`/api/comparisons/${cmp.id}/rediff`, {}],
    [`/api/comparisons/${cmp.id}/share`, { expiresInDays: 1 }],
    [`/api/runs/${run!.id}/cancel`, {}],
    [`/api/runs/${run!.id}/retry-failed`, {}],
    [`/api/runs/${run!.id}/baseline`, {}],
    [`/api/projects/${projectId}/sitemap`, {}],
    [`/api/projects/${projectId}/import-legacy`, { action: 'list' }],
  ] as const) {
    expect((await post(path, data)).status(), path).toBe(403);
  }
  expect((await page.request.delete(`/api/runs/${run!.id}`)).status()).toBe(403);
});

test('7. share link opens without login, read-only; revoked link is 404', async ({ browser }) => {
  const cmp = need(state.comparison, 'comparison');
  const page = await signIn(browser, EDITOR, `/p/${PROJECT.slug}/comparisons/${cmp.id}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByLabel('Expires after (days)').fill('1');
  await page.getByRole('button', { name: 'Create link' }).click();
  const url = await page.getByLabel('Share link').inputValue();
  expect(url).toMatch(/\/share\/[A-Za-z0-9_-]{43}$/);

  const visitor = await (await browser.newContext()).newPage();
  expect((await visitor.goto(url))?.status()).toBe(200);
  await expect(visitor.getByRole('note')).toContainText(`Shared read-only view of ${PROJECT.name}`);
  await expect(visitor.getByTestId('review-toolbar')).toHaveCount(0);
  await expect(visitor.getByRole('button', { name: 'Re-diff' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText('Share link revoked')).toBeVisible();
  expect((await visitor.goto(url))?.status()).toBe(404);
});

test('8. legacy import of a real prototype bucket; legacy ↔ new desktop comparison works', async ({
  browser,
}) => {
  const page = await signIn(browser, ADMIN, '/projects/new');
  await page.getByRole('button', { name: 'Import from .env' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from .env' });
  await dialog.getByLabel('.env contents').fill(env.STAGING_LEGACY_ENV);
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await page.getByLabel('Slug').fill(LEGACY_SLUG);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${LEGACY_SLUG}$`));
  const projectId = (await projectBySlug(LEGACY_SLUG)).id;

  await page.getByRole('button', { name: 'Import existing runs' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import existing runs' });
  const labels = importDialog.getByRole('checkbox');
  await expect(labels.first()).toBeVisible({ timeout: 60_000 });
  // Only the newest prototype run: enough to compare, and quicker.
  const count = await labels.count();
  for (let i = 0; i < count - 1; i++) await labels.nth(i).uncheck();
  await labels.nth(count - 1).check();
  await importDialog.getByRole('button', { name: 'Import 1 run' }).click();
  await expect(page.getByText('Importing 1 run')).toBeVisible();
  const legacy = await waitFor(
    'legacy run imported',
    async () =>
      (
        await staging
          .from('runs')
          .select('id, label, status')
          .eq('project_id', projectId)
          .eq('is_legacy', true)
          .maybeSingle()
      ).data,
    (run) => run?.status === 'completed',
  );

  await fetchSitemap(page, LEGACY_SLUG, projectId);
  await page.goto(`/p/${LEGACY_SLUG}/runs`);
  await page.getByRole('button', { name: 'New run' }).click();
  await page
    .getByRole('dialog', { name: 'New run' })
    .getByRole('button', { name: 'Start run' })
    .click();
  await expect(page).toHaveURL(/\/runs\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  const current = labelFromUrl(page);
  expect(['completed', 'completed_with_errors']).toContain(
    (await waitForRun(projectId, current)).status,
  );

  const cmp = await compare(page, LEGACY_SLUG, projectId, legacy.label, current);
  await page.goto(`/p/${LEGACY_SLUG}/comparisons/${cmp.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `${legacy.label} ↔ ${current}`,
  );
  const compared = (await itemsOf(cmp.id)).filter((i) =>
    ['changed', 'unchanged'].includes(i.status),
  );
  expect(compared.length, 'pages compared between the legacy and the new run').toBeGreaterThan(0);
});

test('9. deleting a run removes its objects and comparisons; the storage page reflects it', async ({
  browser,
}) => {
  const projectId = need(state.projectId, 'project');
  const cmp = need(state.comparison, 'comparison');
  const { baseline_run_id: baseline } = await projectBySlug(PROJECT.slug);
  const { data: runs } = await staging
    .from('runs')
    .select('id, label')
    .eq('project_id', projectId)
    .in('label', [need(state.v1Run, 'v1 run'), need(state.v2Run, 'v2 run')]);
  // The baseline cannot be deleted; either fixture run belongs to the comparison.
  const victim = runs!.find((run) => run.id !== baseline)!;

  const page = await signIn(browser, ADMIN, `/p/${PROJECT.slug}/storage`);
  const table = page.getByRole('table', { name: 'Runs with their size' });
  await expect(table.getByRole('row', { name: new RegExp(victim.label) })).toBeVisible();
  await table.getByRole('button', { name: `Delete run ${victim.label}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(cmp.label);
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await waitFor(
    `run ${victim.label} and comparison ${cmp.label} deleted`,
    async () => {
      const [run, comparison] = await Promise.all([
        staging.from('runs').select('id').eq('id', victim.id).maybeSingle(),
        staging.from('comparisons').select('id').eq('id', cmp.id).maybeSingle(),
      ]);
      return !run.data && !comparison.data;
    },
    (gone) => gone,
    10 * 60_000,
  );
  // DeleteWorkflow removes the rows only after the run's R2 objects are gone (F-RUN-4), so the
  // missing rows prove the objects were deleted. A usage refresh then re-reads the bucket.
  const deletedAt = new Date().toISOString();
  await page.goto(`/p/${PROJECT.slug}/storage`);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await waitFor(
    'storage usage refreshed',
    async () =>
      (
        await staging
          .from('storage_usage')
          .select('status, refreshed_at')
          .eq('project_id', projectId)
          .maybeSingle()
      ).data,
    (row) => row?.status === 'completed' && !!row.refreshed_at && row.refreshed_at > deletedAt,
    10 * 60_000,
  );

  await page.reload();
  await expect(page.getByRole('table', { name: 'Storage by prefix' })).toBeVisible();
  await expect(table.getByRole('row', { name: new RegExp(victim.label) })).toHaveCount(0);
});

test.afterAll(async () => {
  // Leave the fixture site at v1 for the next attempt.
  await switchFixtureSite('v1');
});
