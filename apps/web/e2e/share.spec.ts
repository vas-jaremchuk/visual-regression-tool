import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { adminClient, auditEntries, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { EDITOR, VIEWER } from './fixtures';

/**
 * Static export download and public share links (T17). The project has no public URL, so images
 * go through /api/r2/sign and redirect to presigned R2 URLs, served here from fixtures/png.
 */
const PROJECT = { slug: 'e2e-share-site', name: 'E2E share site' };
const OTHER = { slug: 'e2e-share-other', name: 'E2E share other' };
const R2_ORIGIN = 'https://e2e-account.r2.cloudflarestorage.com';
const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';
const LATER = '2026-11-03_10-00-00';
const CMP_LABEL = `${BEFORE}_vs_${AFTER}`;
/** Another comparison of the same project, and one of another project: never on the share page. */
const SIBLING_LABEL = `${AFTER}_vs_${LATER}`;
const OTHER_LABEL = '2026-10-01_10-00-00_vs_2026-10-02_10-00-00';

const png = readFileSync(
  fileURLToPath(new URL('../../../fixtures/png/block-change-a.png', import.meta.url)),
);

let comparisonId = '';
let siblingId = '';

async function deleteProjects() {
  await adminClient().from('projects').delete().in('slug', [PROJECT.slug, OTHER.slug]);
}

async function seedComparison(slug: string, name: string, labels: [string, string, string?]) {
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      slug,
      name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: `vrt-${slug}`,
    })
    .select('id')
    .single();
  if (error) throw error;
  const runLabels = labels.filter((l): l is string => Boolean(l));
  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .insert(
      runLabels.map((label) => ({
        project_id: project.id,
        label,
        status: 'completed' as const,
        created_at: `${label.slice(0, 10)}T10:00:00Z`,
      })),
    )
    .select('id, label');
  if (runsError) throw runsError;
  const run = (label: string) => runs.find((r) => r.label === label)!.id;
  const comparison = async (before: string, after: string) => {
    const label = `${before}_vs_${after}`;
    const { data, error: cmpError } = await supabase
      .from('comparisons')
      .insert({
        project_id: project.id,
        before_run_id: run(before),
        after_run_id: run(after),
        label,
        status: 'completed',
        settings: { changeThresholdPct: 0.05, viewports: ['desktop'] },
        counts: {
          compared: 2,
          changed: 1,
          unchanged: 1,
          new: 1,
          missing: 0,
          redirect: 0,
          error: 0,
        },
      })
      .select('id')
      .single();
    if (cmpError) throw cmpError;
    const { error: itemsError } = await supabase.from('comparison_items').insert([
      {
        comparison_id: data.id,
        url: `https://www.example.com/changed-${label}`,
        name: 'changed.png',
        kind: 'page' as const,
        viewport_slug: 'desktop',
        status: 'changed' as const,
        diff_pct: 2.5,
        diff_pixels: 77,
        total_pixels: 3072,
        before_key: `screenshots/${before}/desktop/changed.png`,
        after_key: `screenshots/${after}/desktop/changed.png`,
        diff_key: `diffs/${label}/desktop/changed.png`,
        before_dims: [64, 48],
        after_dims: [64, 48],
      },
      {
        comparison_id: data.id,
        url: 'https://www.example.com/same',
        name: 'same.png',
        kind: 'page' as const,
        viewport_slug: 'desktop',
        status: 'unchanged' as const,
        diff_pct: 0,
      },
      {
        comparison_id: data.id,
        url: 'https://www.example.com/fresh',
        name: 'fresh.png',
        kind: 'page' as const,
        viewport_slug: 'desktop',
        status: 'new' as const,
        after_key: `screenshots/${after}/desktop/fresh.png`,
      },
    ]);
    if (itemsError) throw itemsError;
    return data.id;
  };
  const first = await comparison(labels[0], labels[1]);
  const second = labels[2] ? await comparison(labels[1], labels[2]) : '';
  return { first, second };
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  await deleteProjects();
  ({ first: comparisonId, second: siblingId } = await seedComparison(PROJECT.slug, PROJECT.name, [
    BEFORE,
    AFTER,
    LATER,
  ]));
  await seedComparison(OTHER.slug, OTHER.name, ['2026-10-01_10-00-00', '2026-10-02_10-00-00']);
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');
});

test.afterAll(deleteProjects);

const reportPath = () => `/p/${PROJECT.slug}/comparisons/${comparisonId}`;

async function serveR2(page: Page) {
  await page.route(`${R2_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
}

async function setShare(id: string, token: string | null, expiresAt: string | null) {
  const { error } = await adminClient()
    .from('comparisons')
    .update({
      share_token_hash: token ? createHash('sha256').update(token).digest('hex') : null,
      share_expires_at: expiresAt,
    })
    .eq('id', id);
  if (error) throw error;
}

test('editor shares a report; the share page is read-only and reads only that comparison', async ({
  page,
  browser,
}) => {
  await signInWithMagicLink(page, EDITOR, reportPath());
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByLabel('Expires after (days)').fill('7');
  await page.getByRole('button', { name: 'Create link' }).click();
  const url = await page.getByLabel('Share link').inputValue();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3000\/share\/[A-Za-z0-9_-]{43}$/);
  const token = url.split('/share/')[1]!;
  expect(await auditEntries('share_link.created', { comparison_id: comparisonId })).toHaveLength(1);

  // A visitor without a session.
  const visitor = await browser.newContext();
  const share = await visitor.newPage();
  await serveR2(share);
  const appRequests: string[] = [];
  share.on('request', (request) => {
    const u = new URL(request.url());
    if (u.origin === 'http://127.0.0.1:3000' && !u.pathname.startsWith('/_next/')) {
      appRequests.push(u.pathname + u.search);
    }
  });
  const response = await share.goto(url);
  expect(response?.status()).toBe(200);
  await expect(share.getByRole('note')).toContainText(`Shared read-only view of ${PROJECT.name}`);
  await expect(share.getByRole('heading', { level: 1 })).toContainText(`${BEFORE} ↔ ${AFTER}`);
  // No navigation, no review, no share or download controls.
  await expect(share.getByRole('navigation')).toHaveCount(0);
  await expect(share.getByRole('button', { name: 'Share' })).toHaveCount(0);
  await expect(share.getByRole('link', { name: 'Download HTML' })).toHaveCount(0);
  await expect(share.getByRole('button', { name: /approve/i })).toHaveCount(0);

  // The viewer shows the item; its images are signed with the share token.
  const viewer = share.getByTestId('item-viewer');
  await expect(viewer).toContainText(`/changed-${CMP_LABEL}`);
  await expect(viewer.getByRole('img').first()).toHaveJSProperty('complete', true);
  // Filtering pages through the share API.
  await share.getByRole('button', { name: '1 new' }).click();
  await expect(share.getByTestId('item-list').getByRole('option')).toContainText(['/fresh']);

  // Audit of every app request the share page made: only this token and this comparison.
  const html = await share.content();
  expect(html).not.toContain(SIBLING_LABEL);
  expect(html).not.toContain(siblingId);
  expect(html).not.toContain(OTHER_LABEL);
  expect(html).not.toContain(OTHER.name);
  expect(appRequests.length).toBeGreaterThan(0);
  for (const path of appRequests) {
    const u = new URL(path, 'http://127.0.0.1:3000');
    if (u.pathname === `/share/${token}` || u.pathname === '/favicon.ico') continue;
    if (u.pathname === `/api/share/${token}/items`) continue;
    expect(u.pathname, path).toBe('/api/r2/sign');
    expect(u.searchParams.get('token'), path).toBe(token);
    expect(u.searchParams.get('comparison'), path).toBe(comparisonId);
  }
  expect(appRequests.some((p) => p.startsWith('/api/r2/sign'))).toBe(true);
  expect(appRequests.some((p) => p.startsWith(`/api/share/${token}/items`))).toBe(true);

  // The token cannot sign another comparison's objects, nor be used for another comparison.
  const foreign = await share.request.get(
    `/api/r2/sign?token=${token}&key=${encodeURIComponent(`diffs/${SIBLING_LABEL}/desktop/changed.png`)}`,
    { maxRedirects: 0 },
  );
  expect(foreign.status()).toBe(403);
  const wrongComparison = await share.request.get(
    `/api/r2/sign?token=${token}&comparison=${siblingId}&key=${encodeURIComponent(`diffs/${SIBLING_LABEL}/desktop/changed.png`)}`,
    { maxRedirects: 0 },
  );
  expect(wrongComparison.status()).toBe(404);

  // Revoking: the link, the list API and image signing answer 404.
  await page.getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText('Share link revoked')).toBeVisible();
  expect(await auditEntries('share_link.revoked', { comparison_id: comparisonId })).toHaveLength(1);
  expect((await share.goto(url))?.status()).toBe(404);
  expect((await share.request.get(`/api/share/${token}/items`)).status()).toBe(404);
  const signAfterRevoke = await share.request.get(
    `/api/r2/sign?token=${token}&comparison=${comparisonId}&key=${encodeURIComponent(`diffs/${CMP_LABEL}/desktop/changed.png`)}`,
    { maxRedirects: 0 },
  );
  expect(signAfterRevoke.status()).toBe(404);
  await visitor.close();
});

test('an expired token answers 404', async ({ page }) => {
  const token = 'e'.repeat(43);
  await setShare(comparisonId, token, new Date(Date.now() - 60_000).toISOString());
  expect((await page.goto(`/share/${token}`))?.status()).toBe(404);
  expect((await page.request.get(`/api/share/${token}/items`)).status()).toBe(404);

  await setShare(comparisonId, token, new Date(Date.now() + 60_000).toISOString());
  expect((await page.goto(`/share/${token}`))?.status()).toBe(200);
  expect((await page.goto('/share/not-a-token'))?.status()).toBe(404);
  await setShare(comparisonId, null, null);
});

test('viewers download the static HTML with absolute image URLs, and cannot share', async ({
  page,
}) => {
  await signInWithMagicLink(page, VIEWER, reportPath());
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${BEFORE} ↔ ${AFTER}`);
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download HTML' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${CMP_LABEL}.html`);
  const html = readFileSync((await download.path())!, 'utf8');
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).toContain(PROJECT.name);
  const sources = [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]!);
  expect(sources).toHaveLength(3);
  for (const src of sources) expect(src.startsWith(`${R2_ORIGIN}/vrt-${PROJECT.slug}/`)).toBe(true);

  // Another project's comparison is not downloadable.
  const { data: other } = await adminClient()
    .from('comparisons')
    .select('id')
    .eq('label', OTHER_LABEL)
    .single();
  expect((await page.request.get(`/api/comparisons/${other!.id}/export.html`)).status()).toBe(404);
  // Viewers cannot create links through the API either.
  const denied = await page.request.post(`/api/comparisons/${comparisonId}/share`, {
    data: { expiresInDays: 1 },
  });
  expect(denied.status()).toBe(403);
});
