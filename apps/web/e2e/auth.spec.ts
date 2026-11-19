import { expect, test } from '@playwright/test';
import { adminClient, ensureUser, setDisabled } from './helpers/admin';
import { signInWithMagicLink, signOut } from './helpers/auth';
import { E2E_ADMIN, E2E_DISABLED, OTHER_PROJECT, SEEDED_PROJECT, VIEWER } from './fixtures';

test('unauthenticated visitors are redirected to /login with next', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2F');
  await page.goto('/p/example-site/runs?tab=items');
  await expect(page).toHaveURL(
    `/login?next=${encodeURIComponent('/p/example-site/runs?tab=items')}`,
  );
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // GOOGLE_AUTH_ENABLED is not set for e2e.
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
});

test('viewer signs in with a magic link, sees only their projects, and signs out', async ({
  page,
}) => {
  await signInWithMagicLink(page, VIEWER);
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();

  const list = page.getByRole('main').getByRole('list', { name: 'Projects' });
  await expect(list.getByRole('link')).toHaveCount(1);
  await expect(list.getByRole('link', { name: SEEDED_PROJECT.name })).toBeVisible();
  await expect(page.getByText(OTHER_PROJECT.name)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);

  await signOut(page);
  await page.goto('/');
  await expect(page).toHaveURL('/login?next=%2F');
});

test('sign-in returns to the page that required it', async ({ page }) => {
  await signInWithMagicLink(page, VIEWER, `/p/${SEEDED_PROJECT.slug}`);
  await expect(page).toHaveURL(`/p/${SEEDED_PROJECT.slug}`);
});

test('platform admin created by seed:admin sees every project and the admin nav', async ({
  page,
}) => {
  await signInWithMagicLink(page, E2E_ADMIN);
  const list = page.getByRole('main').getByRole('list', { name: 'Projects' });
  await expect(list.getByRole('link', { name: SEEDED_PROJECT.name })).toBeVisible();
  await expect(list.getByRole('link', { name: OTHER_PROJECT.name })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();

  const { data: audit } = await adminClient()
    .from('audit_log')
    .select('action, details')
    .eq('action', 'user.promote_admin')
    .contains('details', { email: E2E_ADMIN });
  expect(audit?.length).toBeGreaterThan(0);
});

test('a disabled user is signed out on the next request and cannot sign in', async ({ page }) => {
  const userId = await ensureUser(E2E_DISABLED);
  try {
    await signInWithMagicLink(page, E2E_DISABLED);
    await expect(page).toHaveURL('/');
    await expect(page.getByText('You are not a member of any project')).toBeVisible();

    await setDisabled(userId, true);
    await page.reload();
    await expect(page).toHaveURL('/login?error=disabled');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Your account has been disabled',
    );

    // The session is gone, and a new magic link does not sign the user back in.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?/);
    await signInWithMagicLink(page, E2E_DISABLED);
    await expect(page).toHaveURL('/login?error=disabled');
  } finally {
    await setDisabled(userId, false);
  }
});
