import { expect, test } from '@playwright/test';
import { adminClient, ensureUser, setMembership } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { EDITOR, VIEWER } from './fixtures';

/** Project with seeded runs and one comparison; the worker is not called. */
const PROJECT = { slug: 'e2e-comparisons-site', name: 'E2E comparisons site' };
const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';

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
      r2_bucket: 'vrt-e2e-comparisons-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  await setMembership(PROJECT.slug, await ensureUser(EDITOR), 'editor');
  await setMembership(PROJECT.slug, await ensureUser(VIEWER), 'viewer');

  const { data: runs, error: runsError } = await supabase
    .from('runs')
    .insert([
      {
        project_id: project.id,
        label: BEFORE,
        status: 'completed',
        created_at: '2026-11-01T10:00:00Z',
      },
      {
        project_id: project.id,
        label: AFTER,
        status: 'completed',
        created_at: '2026-11-02T10:00:00Z',
      },
    ])
    .select('id, label');
  if (runsError) throw runsError;
  const id = (label: string) => runs.find((r) => r.label === label)!.id;
  const { error: cmpError } = await supabase.from('comparisons').insert({
    project_id: project.id,
    before_run_id: id(BEFORE),
    after_run_id: id(AFTER),
    label: `${BEFORE}_vs_${AFTER}`,
    status: 'completed',
    counts: {
      compared: 2,
      changed: 2,
      unchanged: 0,
      new: 1,
      missing: 1,
      redirect: 1,
      error: 0,
      files_changed: 1,
      files_total: 1,
    },
    review_counts: { pending: 1, approved: 1, rejected: 0, ignored: 0 },
  });
  if (cmpError) throw cmpError;
});

test.afterAll(deleteProject);

test('viewer sees the comparisons list with counts and review progress', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, `/p/${PROJECT.slug}/comparisons`);
  await expect(page.getByRole('heading', { level: 1, name: 'Comparisons' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare' })).toHaveCount(0);
  const table = page.getByRole('table');
  await expect(table).toContainText(`${BEFORE} → ${AFTER}`);
  await expect(table).toContainText('2 compared · 2 changed · 1 new · 1 missing · 1 redirected');
  await expect(table).toContainText('files 1/1 changed');
  await expect(table).toContainText('1/2 reviewed');
});

test('editor is asked to confirm before re-running a compared pair', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, `/p/${PROJECT.slug}/comparisons`);
  await expect(page.getByLabel('Before run')).toHaveValue(/.+/);
  await expect(page.getByLabel('Before run').locator('option:checked')).toHaveText(BEFORE);
  await expect(page.getByLabel('After run').locator('option:checked')).toHaveText(AFTER);
  await page.getByRole('button', { name: 'Compare' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace the earlier results?' });
  await expect(dialog).toContainText(`${BEFORE}_vs_${AFTER}`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
