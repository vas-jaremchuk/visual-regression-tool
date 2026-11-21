import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  adminClient,
  auditEntries,
  ensureUser,
  resetAuditWindow,
  setMembership,
} from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { E2E_ADMIN, E2E_PROJECT_ADMIN, EDITOR, SEEDED_PROJECT, VIEWER } from './fixtures';

/** Project created from the prototype `.env` fixture (slug from SITE_NAME). */
const IMPORTED = { slug: 'example-site-2', name: 'Example Site' };
/** Project the project admin edits, so the seeded project stays untouched. */
const SETTINGS_PROJECT = { slug: 'e2e-settings-site', name: 'E2E settings site' };

const envFixture = readFileSync(
  fileURLToPath(new URL('../../../fixtures/prototype-env/example.env', import.meta.url)),
  'utf8',
);

async function deleteProject(slug: string) {
  await adminClient().from('projects').delete().eq('slug', slug);
}

async function project(slug: string) {
  const { data, error } = await adminClient()
    .from('projects')
    .select('id, name, notes, basic_auth_pass_enc, created_by')
    .eq('slug', slug)
    .single();
  if (error) throw error;
  return data;
}

test.beforeEach(async () => {
  resetAuditWindow();
  await deleteProject(IMPORTED.slug);
  await deleteProject(SETTINGS_PROJECT.slug);
  const { data, error } = await adminClient()
    .from('projects')
    .insert({
      slug: SETTINGS_PROJECT.slug,
      name: SETTINGS_PROJECT.name,
      sitemap_index: 'http://localhost:4010/sitemap_index.xml',
      r2_bucket: 'vrt-e2e-settings-site',
    })
    .select('id')
    .single();
  if (error) throw error;
  await adminClient().from('viewports').insert({ project_id: data.id, slug: 'desktop' });
  await setMembership(SETTINGS_PROJECT.slug, await ensureUser(E2E_PROJECT_ADMIN), 'admin');
});

test.afterAll(async () => {
  await deleteProject(IMPORTED.slug);
  await deleteProject(SETTINGS_PROJECT.slug);
});

for (const email of [EDITOR, VIEWER]) {
  test(`${email.split('@')[0]} cannot open project settings (403)`, async ({ page }) => {
    await signInWithMagicLink(page, email, `/p/${SEEDED_PROJECT.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: SEEDED_PROJECT.name })).toBeVisible();
    for (const path of ['settings', 'settings/general', 'settings/storage', 'settings/danger']) {
      const response = await page.goto(`/p/${SEEDED_PROJECT.slug}/${path}`);
      expect(response?.status()).toBe(403);
      await expect(page.getByRole('heading', { name: /403/ })).toBeVisible();
    }
  });
}

test('platform admin creates a project from the prototype .env', async ({ page }) => {
  await signInWithMagicLink(page, E2E_ADMIN, '/');
  await page.getByRole('link', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible();

  await page.getByRole('button', { name: 'Import from .env' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from .env' });
  await dialog.getByLabel('.env contents').fill(envFixture);
  await dialog.getByRole('button', { name: 'Preview' }).click();
  const preview = dialog.getByRole('table', { name: 'Imported values' });
  await expect(preview).toContainText('someproject-visual-test');
  await expect(preview).toContainText('https://www.example.com/sitemap.xml');
  await expect(preview).not.toContainText('s3cret');
  await expect(dialog).toContainText('Ignored: CF_ACCOUNT_ID, CF_API_TOKEN');
  await dialog.getByRole('button', { name: 'Use these values' }).click();

  await expect(page.getByLabel('Name')).toHaveValue(IMPORTED.name);
  await expect(page.getByLabel('R2 bucket')).toHaveValue('someproject-visual-test');
  // The seeded project owns `example-site`, so the import's slug moves to the next free one.
  await page.getByLabel('Slug').fill('');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(new RegExp(`/p/${IMPORTED.slug}$`));
  await expect(page.getByRole('heading', { level: 1, name: IMPORTED.name })).toBeVisible();

  const created = await project(IMPORTED.slug);
  expect(created.basic_auth_pass_enc).toMatch(/^v1:/);
  expect(created.created_by).toBe(await ensureUser(E2E_ADMIN));
  const supabase = adminClient();
  const { data: viewports } = await supabase
    .from('viewports')
    .select('slug, width, height')
    .eq('project_id', created.id);
  expect(viewports).toEqual([{ slug: 'desktop', width: 1280, height: 900 }]);
  const { data: members } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', created.id)
    .eq('user_id', created.created_by!);
  expect(members).toEqual([{ role: 'admin' }]);
  const [entry] = await auditEntries('project.create', {});
  expect(JSON.stringify(entry?.details)).not.toContain('s3cret');
  expect(entry?.details).toMatchObject({ settings: { basicAuthPass: '[redacted]' } });
});

test('create form shows validation errors inline', async ({ page }) => {
  await signInWithMagicLink(page, E2E_ADMIN, '/projects/new');
  await page.getByLabel('Name').fill('Broken');
  await page.getByLabel('Sitemap index URL').fill('not a url');
  await page.getByLabel('R2 bucket').fill('UPPER');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Expected an http(s) URL')).toBeVisible();
  await expect(page.getByText(/Bucket names are 3/)).toBeVisible();
  await expect(page.getByLabel('R2 bucket')).toHaveAttribute('aria-invalid', 'true');
});

test('project admin edits settings: inline errors, audit, password', async ({ page }) => {
  const base = `/p/${SETTINGS_PROJECT.slug}/settings`;
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, base);
  await expect(page).toHaveURL(new RegExp(`${base}/general$`));

  await page.getByLabel('Name').fill('');
  await page.getByLabel('Slug').fill('Bad Slug');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This field is required')).toBeVisible();
  await expect(page.getByText('Use lowercase letters, digits and single dashes')).toBeVisible();

  await page.getByLabel('Name').fill('Renamed site');
  await page.getByLabel('Slug').fill(SETTINGS_PROJECT.slug);
  await page.getByLabel('Notes').fill('Staging only');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await expect.poll(async () => (await project(SETTINGS_PROJECT.slug)).notes).toBe('Staging only');
  const [entry] = await auditEntries('project.settings.update', { group: 'general' });
  expect(entry?.details).toMatchObject({
    changes: {
      name: { old: SETTINGS_PROJECT.name, new: 'Renamed site' },
      notes: { old: null, new: 'Staging only' },
    },
  });

  await page.getByRole('link', { name: 'Capture' }).click();
  await page.getByLabel('Concurrency').fill('99');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Concurrency must be at most 10')).toBeVisible();

  await page.getByRole('link', { name: 'Access' }).click();
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByPlaceholder('New password').fill('hunter2-secret');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('••••• (set)')).toBeVisible();
  expect((await project(SETTINGS_PROJECT.slug)).basic_auth_pass_enc).toMatch(/^v1:/);
  const [secret] = await auditEntries('project.settings.update', { group: 'access' });
  expect(JSON.stringify(secret?.details)).not.toContain('hunter2');
  expect(secret?.details).toMatchObject({
    changes: { basicAuthPass: { old: null, new: '[redacted]' } },
  });
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('Not set')).toBeVisible();
});

test('project admin manages viewports', async ({ page }) => {
  await signInWithMagicLink(
    page,
    E2E_PROJECT_ADMIN,
    `/p/${SETTINGS_PROJECT.slug}/settings/viewports`,
  );
  await page.getByRole('button', { name: 'Add viewport' }).click();
  await page.getByLabel('Preset').selectOption('mobile');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const list = page.getByRole('list', { name: 'Viewports' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('390×844');

  await page.getByRole('button', { name: 'Move mobile up' }).click();
  await expect(list.getByRole('listitem').first()).toContainText('mobile');
  await expect(page.getByRole('button', { name: 'Delete desktop' })).toBeEnabled();
  expect(await auditEntries('viewport.reorder', { order: ['mobile', 'desktop'] })).toHaveLength(1);
});
