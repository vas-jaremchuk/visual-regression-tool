import { expect, test } from '@playwright/test';

test('the email field keeps its value after a validation error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter a valid email address');
  await expect(page.getByLabel('Email')).toHaveValue('not-an-email');
});

test('an unknown email gets the same answer as a known one', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
});

test('an invalid callback link shows an error on /login', async ({ page }) => {
  await page.goto('/auth/callback?code=bogus');
  await expect(page).toHaveURL('/login?error=link');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('invalid or has expired');
});
