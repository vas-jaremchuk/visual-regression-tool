import { expect, test } from '@playwright/test';
import { adminClient, ensureUser } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { E2E_ADMIN, E2E_PROJECT_ADMIN, EDITOR, SEEDED_PROJECT } from './fixtures';

/** Admin audit log and job health pages (T24, F-ADMIN-2/3). */
const PROJECT = { slug: 'e2e-admin-jobs', name: 'E2E admin jobs' };
const STUCK_LABEL = 'e2e-quiet-run';
const FRESH_LABEL = 'e2e-fresh-run';
const ACTION = 'e2e.admin_audit';

async function deleteProject() {
  await adminClient().from('projects').delete().eq('slug', PROJECT.slug);
}

async function seededProjectId() {
  const { data, error } = await adminClient()
    .from('projects')
    .select('id')
    .eq('slug', SEEDED_PROJECT.slug)
    .single();
  if (error) throw error;
  return data.id;
}

test.afterAll(deleteProject);

test('job health shows a run without progress for more than 15 minutes as stuck', async ({
  page,
}) => {
  await deleteProject();
  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      slug: PROJECT.slug,
      name: PROJECT.name,
      sitemap_index: 'https://www.example.com/sitemap.xml',
      r2_bucket: 'vrt-e2e-admin-jobs',
    })
    .select('id')
    .single();
  if (error) throw error;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const { error: runError } = await supabase.from('runs').insert([
    {
      project_id: project.id,
      label: STUCK_LABEL,
      status: 'running',
      total_items: 4,
      done_items: 1,
      started_at: minutesAgo(40),
      created_at: minutesAgo(40),
    },
    {
      project_id: project.id,
      label: FRESH_LABEL,
      status: 'running',
      total_items: 2,
      started_at: minutesAgo(2),
    },
  ]);
  if (runError) throw runError;

  await signInWithMagicLink(page, E2E_ADMIN, '/admin/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'made no progress' })).toContainText(
    'more than 15 minutes',
  );
  const stuckRow = page.getByRole('row').filter({ hasText: STUCK_LABEL });
  await expect(stuckRow).toContainText(PROJECT.name);
  await expect(stuckRow.getByText('stuck', { exact: true })).toBeVisible();
  const freshRow = page.getByRole('row').filter({ hasText: FRESH_LABEL });
  await expect(freshRow).toContainText('running');
  await expect(freshRow).not.toContainText('stuck');
  // The Cloudflare API is not reachable with the e2e token: each queue reports why.
  await expect(page.getByText('vrt-capture-dlq')).toBeVisible();
  await expect(page.getByText('vrt-diff-dlq')).toBeVisible();
});

test('platform admins filter the audit log; project admins see their project tab', async ({
  page,
}) => {
  const supabase = adminClient();
  const projectId = await seededProjectId();
  const actor = await ensureUser(E2E_PROJECT_ADMIN);
  await supabase.from('audit_log').delete().like('action', 'e2e.%');
  const { error } = await supabase.from('audit_log').insert([
    { actor_id: actor, project_id: projectId, action: ACTION, details: { marker: 'project' } },
    {
      actor_id: actor,
      project_id: null,
      action: `${ACTION}_platform`,
      details: { marker: 'platform' },
    },
  ]);
  if (error) throw error;

  try {
    await signInWithMagicLink(page, E2E_ADMIN, `/admin/audit?action=${ACTION}`);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `${ACTION}_platform` })).toContainText(
      'Platform',
    );
    await page.getByLabel('Project').selectOption({ label: SEEDED_PROJECT.name });
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/project=/);
    await expect(page.getByRole('row').filter({ hasText: ACTION })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: ACTION })).toContainText(
      SEEDED_PROJECT.name,
    );

    await page.context().clearCookies();
    await signInWithMagicLink(
      page,
      E2E_PROJECT_ADMIN,
      `/p/${SEEDED_PROJECT.slug}/settings/audit?action=${ACTION}`,
    );
    await expect(page.getByRole('heading', { name: 'Audit log', level: 2 })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: ACTION })).toHaveCount(1);
    await expect(page.getByText(`${ACTION}_platform`)).toHaveCount(0);

    // Not a platform admin: the admin page does not exist for them.
    const response = await page.goto('/admin/audit');
    expect(response?.status()).toBe(404);

    await page.context().clearCookies();
    await signInWithMagicLink(page, EDITOR, '/');
    const editorTab = await page.goto(`/p/${SEEDED_PROJECT.slug}/settings/audit`);
    expect(editorTab?.status()).toBe(403);
  } finally {
    await supabase.from('audit_log').delete().like('action', 'e2e.%');
  }
});
