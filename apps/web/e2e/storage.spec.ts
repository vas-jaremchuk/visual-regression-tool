import { expect, test } from '@playwright/test';
import { adminClient, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { E2E_ADMIN, E2E_PROJECT_ADMIN, EDITOR } from './fixtures';

/** Project with a baseline run, a second run, one comparison and cached usage; no worker runs. */
const PROJECT = { slug: 'e2e-storage-site', name: 'E2E storage site' };
const BASELINE = '2026-11-01_10-00-00';
const LATEST = '2026-11-02_10-00-00';
const CMP_LABEL = `${BASELINE}_vs_${LATEST}`;

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

test.beforeEach(async () => {
  await deleteProject();
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: 'vrt-e2e-storage-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  await setMembership(PROJECT.slug, await ensureUser(E2E_PROJECT_ADMIN), 'admin');
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .insert([
      { project_id: project.id, label: BASELINE, status: 'completed' },
      { project_id: project.id, label: LATEST, status: 'completed' },
    ])
    .select('id, label');
  if (runsError) throw runsError;
  const id = (label: string) => runs.find((r) => r.label === label)!.id;
  const { error: itemsError } = await supabase.from('run_items').insert([
    {
      run_id: id(LATEST),
      url: 'https://www.example.com/',
      kind: 'page',
      viewport_slug: 'desktop',
      filename: 'home.png',
      status: 'done',
      bytes: 2 * 1024 * 1024,
    },
  ]);
  if (itemsError) throw itemsError;
  await supabase
    .from('projects')
    .update({ baseline_run_id: id(BASELINE) })
    .eq('id', project.id);
  const { error: cmpError } = await supabase.from('comparisons').insert({
    project_id: project.id,
    before_run_id: id(BASELINE),
    after_run_id: id(LATEST),
    label: CMP_LABEL,
    status: 'completed',
  });
  if (cmpError) throw cmpError;
  const { error: usageError } = await supabase.from('storage_usage').insert({
    project_id: project.id,
    bucket: 'vrt-e2e-storage-site',
    status: 'completed',
    total_bytes: 3 * 1024 * 1024,
    object_count: 3,
    groups: [
      { prefix: 'screenshots', bytes: 2 * 1024 * 1024, objects: 2 },
      { prefix: 'diffs', bytes: 1024 * 1024, objects: 1 },
      { prefix: 'reports', bytes: 0, objects: 0 },
      { prefix: 'other', bytes: 0, objects: 0 },
    ],
    refreshed_at: '2026-11-22T10:00:00Z',
  });
  if (usageError) throw usageError;
});

test.afterAll(deleteProject);

test('project admin sees usage by prefix, run sizes and a protected baseline', async ({ page }) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, `/p/${PROJECT.slug}/storage`);
  await expect(page.getByRole('heading', { level: 1, name: 'Storage' })).toBeVisible();
  const usage = page.getByRole('table', { name: 'Storage by prefix' });
  await expect(usage).toContainText('screenshots');
  await expect(usage).toContainText('3.0 MB');
  await expect(page.getByRole('meter', { name: 'Free tier usage' })).toBeVisible();

  const runs = page.getByRole('table', { name: 'Runs with their size' });
  await expect(runs.getByRole('row', { name: new RegExp(LATEST) })).toContainText('2.0 MB');
  await expect(runs.getByRole('row', { name: new RegExp(BASELINE) })).toContainText(
    'baseline, set another to delete',
  );
  await expect(page.getByRole('button', { name: `Delete run ${BASELINE}` })).toHaveCount(0);
});

test('deleting a run lists its comparisons; a failed start leaves delete_failed with retry', async ({
  page,
}) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, `/p/${PROJECT.slug}/storage`);
  await page
    .getByRole('table', { name: 'Runs with their size' })
    .getByRole('button', { name: `Delete run ${LATEST}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Delete run ${LATEST}?`);
  await expect(dialog).toContainText(CMP_LABEL);
  // No worker runs in e2e, so starting the DeleteWorkflow fails.
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Could not start the delete job. Try again.')).toBeVisible();
  await page.reload();
  const row = page
    .getByRole('table', { name: 'Runs with their size' })
    .getByRole('row', { name: new RegExp(LATEST) });
  await expect(row).toContainText('delete_failed');
  await expect(row.getByRole('button', { name: `Retry delete run ${LATEST}` })).toBeVisible();
});

test('retention proposes older non-baseline runs only', async ({ page }) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, `/p/${PROJECT.slug}/storage?keep=0`);
  await expect(page.getByRole('main').getByText('1 run (2.0 MB) could be deleted:')).toBeVisible();
});

test('editors cannot open the storage page', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}/storage`);
  await expect(page.getByRole('heading', { level: 1, name: 'Storage' })).toHaveCount(0);
});

test('platform admin sees every project on admin storage', async ({ page }) => {
  await signInWithMagicLink(page, E2E_ADMIN, '/admin/storage');
  const table = page.getByRole('table', { name: 'Storage by project' });
  await expect(table.getByRole('row', { name: new RegExp(PROJECT.name) })).toContainText('3.0 MB');
});
