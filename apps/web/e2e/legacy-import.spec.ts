import { expect, test } from '@playwright/test';
import { adminClient, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { E2E_PROJECT_ADMIN, EDITOR } from './fixtures';

/**
 * F-RUN-6 *Import existing runs*. R2 and the worker are not reachable from e2e, so the dialog's
 * calls to `POST /api/projects/:id/import-legacy` are answered in the browser; the listing and
 * import logic is covered by unit tests against `fixtures/legacy-bucket`.
 */
const PROJECT = { slug: 'e2e-legacy-site', name: 'E2E legacy site' };
const LABELS = ['2026-08-07_10-00-00', '2026-08-08_09-30-00'];

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

let projectId: string;

test.beforeEach(async () => {
  await deleteProject();
  const { data, error } = await adminClient()
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: 'vrt-e2e-legacy-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  projectId = data.id;
  await setMembership(PROJECT.slug, await ensureUser(E2E_PROJECT_ADMIN), 'admin');
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
});

test.afterAll(deleteProject);

test('project admin selects prototype runs and starts the import', async ({ page }) => {
  const imports: unknown[] = [];
  await page.route(`**/api/projects/${projectId}/import-legacy`, async (route) => {
    const body = route.request().postDataJSON() as { action: string; labels?: string[] };
    if (body.action === 'list') return route.fulfill({ json: { labels: LABELS } });
    imports.push(body);
    return route.fulfill({ status: 202, json: { workflowId: 'wf-e2e' } });
  });

  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, `/p/${PROJECT.slug}`);
  await page.getByRole('button', { name: 'Import existing runs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import existing runs' });
  for (const label of LABELS) await expect(dialog.getByLabel(label)).toBeChecked();

  await dialog.getByLabel(LABELS[1]!).uncheck();
  await dialog.getByRole('button', { name: 'Import 1 run' }).click();
  await expect(page.getByText('Importing 1 run')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(imports).toEqual([{ action: 'import', labels: [LABELS[0]] }]);
});

test('the dialog shows empty and error states', async ({ page }) => {
  let fail = true;
  await page.route(`**/api/projects/${projectId}/import-legacy`, (route) =>
    fail
      ? route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'R2 down' } } })
      : route.fulfill({ json: { labels: [] } }),
  );

  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, `/p/${PROJECT.slug}`);
  await page.getByRole('button', { name: 'Import existing runs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import existing runs' });
  await expect(dialog.getByRole('alert')).toContainText('R2 down');

  fail = false;
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText('No prototype runs left to import.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import 0 runs' })).toBeDisabled();
});

test('editors neither see nor may call the import', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: PROJECT.name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import existing runs' })).toHaveCount(0);

  const res = await page.request.post(`/api/projects/${projectId}/import-legacy`, {
    data: { action: 'list' },
  });
  expect(res.status()).toBe(403);
});
