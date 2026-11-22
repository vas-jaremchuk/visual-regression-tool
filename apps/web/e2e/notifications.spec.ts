import { expect, test } from '@playwright/test';
import { adminClient, auditEntries, resetAuditWindow } from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { E2E_PROJECT_ADMIN, SEEDED_PROJECT, VIEWER } from './fixtures';

const SETTINGS_PATH = `/p/${SEEDED_PROJECT.slug}/settings/notifications`;
const WEBHOOK = 'https://hooks.slack.com/services/TE2E/BE2E/e2e-webhook-secret';

async function projectId() {
  const { data, error } = await adminClient()
    .from('projects')
    .select('id')
    .eq('slug', SEEDED_PROJECT.slug)
    .single();
  if (error) throw error;
  return data.id;
}

test.beforeEach(async () => {
  resetAuditWindow();
  const id = await projectId();
  await adminClient().from('notification_channels').delete().eq('project_id', id);
  await adminClient().from('notification_mutes').delete().eq('project_id', id);
});

test('project admin adds channels; the Slack webhook URL never reaches the browser', async ({
  page,
}) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, SETTINGS_PATH);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('No channels yet.').first()).toBeVisible();

  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByLabel('Type').selectOption('slack');
  await page.getByLabel('Webhook URL').fill(WEBHOOK);
  await page.getByLabel('Run failed').check();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await expect(page.getByText('Channel added')).toBeVisible();
  const channels = page.getByRole('list', { name: 'Notification channels' });
  await expect(channels.getByText('Slack incoming webhook')).toBeVisible();

  await page.reload();
  expect(await page.content()).not.toContain('e2e-webhook-secret');
  expect(JSON.stringify(await auditEntries('notification_channel.create', {}))).not.toContain(
    'e2e-webhook-secret',
  );
  const { data } = await adminClient()
    .from('notification_channels')
    .select('target, target_enc')
    .eq('type', 'slack')
    .single();
  expect(data!.target).toBeNull();
  expect(data!.target_enc).not.toContain('hooks.slack.com');

  // Email channel for all members; its test goes to the admin only and is logged.
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await expect(page.getByText('Channel added')).toBeVisible();
  const email = channels.getByRole('listitem').filter({ hasText: 'All project members' });
  await email.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Test sent')).toBeVisible();
  await email.getByText(/Delivery log/).click();
  await expect(email.getByRole('cell', { name: 'test' })).toBeVisible();
  await expect(email.getByRole('cell', { name: 'sent' })).toBeVisible();
});

test('a viewer cannot open the notifications settings', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, SETTINGS_PATH);
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
});

test('a member mutes a project for themselves in /account', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, '/account');
  await expect(page.getByRole('heading', { name: 'Notification mutes' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: SEEDED_PROJECT.name });
  await row.getByLabel('Mute emails').check();
  await expect(page.getByText('Project muted')).toBeVisible();
  const { data } = await adminClient()
    .from('notification_mutes')
    .select('user_id')
    .eq('project_id', await projectId());
  expect(data).toHaveLength(1);
});
