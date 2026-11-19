import { expect, type Page } from '@playwright/test';
import { clearMailbox, getMagicLink } from './mailpit';

/** Signs in through the real /login form and the emailed magic link. */
export async function signInWithMagicLink(page: Page, email: string, path = '/') {
  await clearMailbox(email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  // Supabase throttles OTP emails per address (auth.email.max_frequency); retry until accepted.
  await expect(async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    await expect(page.getByRole('status')).toContainText('Check your email', { timeout: 2_000 });
  }).toPass({ intervals: [1_000], timeout: 15_000 });
  await page.goto(await getMagicLink(email));
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}
