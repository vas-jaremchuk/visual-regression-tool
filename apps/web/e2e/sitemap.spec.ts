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

/** Project with seeded snapshots; the worker is not called (snapshots are inserted directly). */
const PROJECT = { slug: 'e2e-sitemap-site', name: 'E2E sitemap site' };
const BASE = 'https://www.example.com';

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

async function seedSnapshot(
  projectId: string,
  createdAt: string,
  urls: {
    url: string;
    kind?: 'page' | 'file';
    http_status?: number | null;
    redirect_to?: string | null;
    included?: boolean;
    source?: string;
  }[],
) {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('sitemap_snapshots')
    .insert({
      project_id: projectId,
      status: 'completed',
      source_url: `${BASE}/sitemap.xml`,
      child_sitemaps: 1,
      url_count: urls.filter((row) => row.included !== false).length,
      urls_total: urls.length,
      urls_checked: urls.length,
      created_at: createdAt,
      finished_at: createdAt,
    })
    .select('id')
    .single();
  if (error) throw error;
  const { error: urlsError } = await supabase
    .from('sitemap_urls')
    // Bulk inserts send null for keys missing in some rows, so every row gets every column.
    .insert(
      urls.map((row) => ({
        kind: 'page' as const,
        http_status: null,
        redirect_to: null,
        included: true,
        source: 'sitemap',
        ...row,
        snapshot_id: data.id,
      })),
    );
  if (urlsError) throw urlsError;
  return data.id;
}

let projectId: string;

test.beforeEach(async () => {
  resetAuditWindow();
  await deleteProject();
  const { data, error } = await adminClient()
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: `${BASE}/sitemap.xml`,
      r2_bucket: 'vrt-e2e-sitemap-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  projectId = data.id;
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');

  const day = 24 * 60 * 60 * 1000;
  await seedSnapshot(projectId, new Date(Date.now() - 2 * day).toISOString(), [
    { url: `${BASE}/`, http_status: 200 },
    { url: `${BASE}/gone`, http_status: 200 },
  ]);
  await seedSnapshot(projectId, new Date(Date.now() - day).toISOString(), [
    { url: `${BASE}/`, http_status: 200 },
    { url: `${BASE}/about`, http_status: 200 },
    { url: `${BASE}/old`, http_status: 301, redirect_to: `${BASE}/new`, included: false },
    { url: `${BASE}/missing`, http_status: 404 },
    { url: `${BASE}/brochure.pdf`, kind: 'file', http_status: 200 },
  ]);
});

test.afterAll(deleteProject);

test('viewer browses snapshot URLs, filters, diff and export', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, `/p/${PROJECT.slug}/sitemap`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sitemap' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fetch sitemap' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add URL' })).toHaveCount(0);

  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(6);

  const filters = page.getByRole('navigation', { name: 'URL filters' });
  await expect(filters.getByRole('link', { name: 'Redirects 1' })).toBeVisible();
  await filters.getByRole('link', { name: /^Errors/ }).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText(`${BASE}/missing`);
  await filters.getByRole('link', { name: /^Files/ }).click();
  await expect(table).toContainText('brochure.pdf');
  await expect(table.getByRole('row')).toHaveCount(2);

  await page.getByRole('searchbox', { name: 'Search URLs' }).fill('about');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No URLs match this filter.')).toBeVisible();

  const added = page.getByRole('region', { name: 'Added URLs' });
  await expect(added).toContainText(`${BASE}/about`);
  await expect(page.getByRole('region', { name: 'Removed URLs' })).toContainText(`${BASE}/gone`);

  const res = await page.request.get(
    (await page.getByRole('link', { name: 'Export .txt' }).getAttribute('href'))!,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toBe('attachment; filename="sitemap.txt"');
  expect(await res.text()).toBe(
    [`${BASE}/`, `${BASE}/about`, `${BASE}/brochure.pdf`, `${BASE}/missing`].join('\n') + '\n',
  );
});

test('editor adds and removes a manual URL', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}/sitemap`);
  await expect(page.getByRole('button', { name: 'Fetch sitemap' })).toBeEnabled();

  await page.getByLabel('URL', { exact: true }).fill(`${BASE}/landing`);
  await page.getByRole('button', { name: 'Add URL' }).click();
  const list = page.getByRole('list', { name: 'Manual URLs' });
  await expect(list).toContainText(`${BASE}/landing`);
  expect(await auditEntries('sitemap.manual_url.add', { url: `${BASE}/landing` })).toHaveLength(1);

  await page.getByRole('button', { name: `Remove ${BASE}/landing` }).click();
  await expect(page.getByText(/No manual URLs/)).toBeVisible();
  expect(await auditEntries('sitemap.manual_url.remove', { url: `${BASE}/landing` })).toHaveLength(
    1,
  );
});
