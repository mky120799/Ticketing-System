import { expect, test } from '@playwright/test';
import { PORTAL, expectAccessible, signIn } from './helpers';

test('a customer signs in, raises a complaint, follows it and replies', async ({ page }) => {
  await page.goto(PORTAL);
  await expect(page.getByRole('heading', { name: 'Make a request or complaint' })).toBeVisible();
  await expectAccessible(page, 'portal sign-in page');
  await signIn(page, PORTAL, 'Sign in', 'local-customer');
  await expect(page.getByRole('heading', { name: 'Your requests and complaints' })).toBeVisible();
  await expectAccessible(page, 'portal home');

  const subject = `Browser test complaint ${Date.now()}`;
  await page.getByLabel('Make a complaint').check();
  await page.getByLabel('Short summary').fill(subject);
  await page.getByRole('textbox', { name: 'Details' }).fill('This was raised by an automated browser test.');
  await page.getByRole('button', { name: 'Send to the bank' }).click();
  await expect(page.getByText(/Your reference is CASE-[0-9A-F]{8}/)).toBeVisible();
  await expect(page.getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByText(/final response by/i)).toBeVisible();
  await expectAccessible(page, 'portal request detail');

  await page.getByLabel('Add a message').fill('Here is some extra detail.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Your message has been sent.')).toBeVisible();
  await expect(page.locator('.updates li.you').first()).toContainText('Here is some extra detail.');
  await page.getByRole('button', { name: 'Sign out' }).click();
});
