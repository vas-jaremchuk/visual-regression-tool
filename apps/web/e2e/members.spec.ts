import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  adminClient,
  auditEntries,
  deleteUserByEmail,
  ensureUser,
  resetAuditWindow,
  setDisabled,
  setMembership,
} from './helpers/admin';
import { signInWithMagicLink } from './helpers/auth';
import { clearMailbox, getInviteLink, getMagicLink } from './helpers/mailpit';
import { E2E_PROJECT_ADMIN, EDITOR, OTHER_PROJECT, SEEDED_PROJECT, VIEWER } from './fixtures';

const MEMBERS_PATH = `/p/${SEEDED_PROJECT.slug}/settings/members`;
const INVITEE = 'e2e-invitee@example.com';

async function projectId(slug: string) {
  const { data, error } = await adminClient()
    .from('projects')
    .select('id')
    .eq('slug', slug)
    .single();
  if (error) throw error;
  return data.id;
}

test.beforeEach(async () => {
  resetAuditWindow();
  await deleteUserByEmail(INVITEE);
  await clearMailbox(INVITEE);
});

test('an uninvited email cannot create an account', async () => {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await anon.auth.signInWithOtp({
    email: INVITEE,
    options: { shouldCreateUser: true },
  });
  expect(error?.message).toContain('Not invited');
  const { data } = await adminClient().from('profiles').select('id').eq('email', INVITEE);
  expect(data).toEqual([]);
});

test('project admin invites a new user who signs up and accepts', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const page = await adminContext.newPage();
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, MEMBERS_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

  await page.getByLabel('Email').fill(INVITEE.toUpperCase());
  await page.getByLabel('Role', { exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText('Invitation sent')).toBeVisible();
  const pending = page.getByRole('list', { name: 'Pending invitations' });
  await expect(pending.getByText(INVITEE)).toBeVisible();
  expect(await auditEntries('invitation.create', { email: INVITEE })).toHaveLength(1);
  const link = await getInviteLink(INVITEE);
  await adminContext.close();

  // The invitee is not signed in: the link offers a sign-in link that may create the account.
  const invitee = await browser.newPage();
  await invitee.goto(link);
  await expect(invitee.getByText(`to ${SEEDED_PROJECT.name} as editor`)).toBeVisible();
  await clearMailbox(INVITEE);
  await invitee.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(invitee.getByRole('status')).toContainText('Check your email');
  await invitee.goto(await getMagicLink(INVITEE));
  await expect(invitee).toHaveURL(new URL(link).pathname);
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(invitee).toHaveURL(`/p/${SEEDED_PROJECT.slug}`);

  const { data: member } = await adminClient()
    .from('project_members')
    .select('role, profiles!inner(email)')
    .eq('profiles.email', INVITEE)
    .single();
  expect(member?.role).toBe('editor');
  expect(await auditEntries('member.add', { email: INVITEE, via: 'invitation' })).toHaveLength(1);

  // The link is single-use.
  await invitee.goto(link);
  await expect(invitee.getByText('This invitation has already been accepted.')).toBeVisible();
});

test('revoked and expired invitation links show an error', async ({ page }) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, MEMBERS_PATH);
  await page.getByLabel('Email').fill(INVITEE);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Pending invitations' })).toContainText(INVITEE);
  const firstLink = await getInviteLink(INVITEE);

  // Resending replaces the token: the old link stops working.
  await clearMailbox(INVITEE);
  await page.getByRole('button', { name: `Resend invitation to ${INVITEE}` }).click();
  await expect(page.getByText('Invitation resent')).toBeVisible();
  const link = await getInviteLink(INVITEE);
  expect(link).not.toBe(firstLink);
  expect(await auditEntries('invitation.resend', { email: INVITEE })).toHaveLength(1);

  // Expired after 7 days.
  await adminClient()
    .from('invitations')
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq('email', INVITEE);
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole('main').getByRole('alert')).toContainText(
    'This invitation has expired.',
  );

  await page.getByRole('button', { name: `Revoke invitation to ${INVITEE}` }).click();
  await expect(page.getByText('Invitation revoked')).toBeVisible();
  expect(await auditEntries('invitation.revoke', { email: INVITEE })).toHaveLength(1);
  for (const url of [link, firstLink]) {
    await visitor.goto(url);
    await expect(visitor.getByRole('main').getByRole('alert')).toContainText(
      'This invitation link is invalid or has been revoked.',
    );
  }
});

test('project admin changes a role and removes a member, with audit entries', async ({ page }) => {
  const userId = await ensureUser(INVITEE);
  const id = await setMembership(SEEDED_PROJECT.slug, userId, 'viewer');
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, MEMBERS_PATH);

  await page.getByLabel(`Role of ${INVITEE}`).selectOption('editor');
  await expect(page.getByText('Role updated')).toBeVisible();
  expect(await auditEntries('member.update_role', { user_id: userId, role: 'editor' })).toEqual([
    expect.objectContaining({ project_id: id }),
  ]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `Remove ${INVITEE}` }).click();
  await expect(page.getByText('Member removed')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Members' })).not.toContainText(INVITEE);
  expect(await auditEntries('member.remove', { user_id: userId })).toHaveLength(1);
});

test('an existing user is added directly', async ({ page }) => {
  const userId = await ensureUser(INVITEE);
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, MEMBERS_PATH);
  await page.getByLabel('Email').fill(INVITEE);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText(`${INVITEE} already has an account and was added`)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Members' })).toContainText(INVITEE);
  expect(await auditEntries('member.add', { user_id: userId })).toHaveLength(1);
});

test('editors cannot invite: hidden UI and 403', async ({ page }) => {
  await signInWithMagicLink(page, EDITOR, MEMBERS_PATH);
  await expect(page.getByRole('list', { name: 'Members' })).toContainText(VIEWER);
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);

  const response = await page.request.post('/api/invitations', {
    data: { email: INVITEE, projectId: await projectId(SEEDED_PROJECT.slug), role: 'viewer' },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('forbidden');
});

test('a project admin cannot manage members of other projects', async ({ page }) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN);
  const other = await projectId(OTHER_PROJECT.slug);
  const invite = await page.request.post('/api/invitations', {
    data: { email: INVITEE, projectId: other, role: 'viewer' },
  });
  expect(invite.status()).toBe(403);

  const { data: invitation } = await adminClient()
    .from('invitations')
    .insert({ email: INVITEE, project_id: other, role: 'viewer', token_hash: 'e2e-other' })
    .select('id')
    .single();
  const revoke = await page.request.delete(`/api/invitations/${invitation!.id}`);
  expect(revoke.status()).toBe(403);

  const platform = await page.request.post('/api/invitations', { data: { email: INVITEE } });
  expect(platform.status()).toBe(403);
});

test('platform admin manages users on /admin/users', async ({ page }) => {
  const userId = await ensureUser(INVITEE);
  try {
    await signInWithMagicLink(page, 'e2e-admin@example.com', '/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    const users = page.getByRole('list', { name: 'Users' });
    await expect(users).toContainText(`${SEEDED_PROJECT.name} (editor)`);

    await page.getByRole('button', { name: `Disable ${INVITEE}` }).click();
    await expect(page.getByText('User disabled')).toBeVisible();
    await page.getByRole('button', { name: `Enable ${INVITEE}` }).click();
    await expect(page.getByText('User enabled')).toBeVisible();
    await page.getByRole('button', { name: `Promote ${INVITEE}` }).click();
    await expect(page.getByText('Promoted to platform admin')).toBeVisible();
    await page.getByRole('button', { name: `Demote ${INVITEE}` }).click();
    await expect(page.getByText('Platform admin removed')).toBeVisible();
    for (const action of [
      'user.disable',
      'user.enable',
      'user.promote_admin',
      'user.demote_admin',
    ]) {
      expect(await auditEntries(action, { user_id: userId })).toHaveLength(1);
    }

    await deleteUserByEmail(INVITEE);
    await page.reload();
    await page.getByLabel('Email').fill(INVITEE);
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByText('Invitation sent')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Pending invitations' })).toContainText(INVITEE);
    await getInviteLink(INVITEE);
  } finally {
    await setDisabled(userId, false).catch(() => undefined);
  }
});

test('non-admins do not get /admin/users', async ({ page }) => {
  await signInWithMagicLink(page, E2E_PROJECT_ADMIN, '/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toHaveCount(0);
});
