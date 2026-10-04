import { expect, test } from '@playwright/test';
import { STAFF, expectAccessible, signIn } from './helpers';

test('login screen is accessible', async ({ page }) => {
  await page.goto(STAFF);
  await expect(page.getByRole('heading', { name: 'Bank Case Platform' })).toBeVisible();
  await expectAccessible(page, 'staff sign-in page');
});

test('a supervisor works a ticket through its life', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-supervisor');
  await expect(page.getByRole('heading', { name: 'Case workspace' })).toBeVisible();
  await expect(page.getByText('● Live')).toBeVisible({ timeout: 20_000 });

  // create a ticket through the form
  const subject = `Browser test ticket ${Date.now()}`;
  const form = page.locator('section.create form');
  await form.getByLabel('category').fill('service-request'); await form.getByLabel('queue').fill('customer-support');
  await form.getByLabel('branch Code').fill('BLR-01'); await form.getByLabel('department').fill('operations');
  await form.getByLabel('legal Entity').fill('BANK-IN'); await form.getByLabel('country').fill('IN');
  await form.getByLabel('subject').fill(subject); await form.getByLabel('source System').fill('CRM'); await form.getByLabel('opaque Reference').fill('opaque-customer-1234');
  await form.getByLabel('description').fill('Created by the browser test.');
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByText('••••')).toBeVisible(); // references are masked
  await expectAccessible(page, 'staff workspace with a ticket open');

  // resolve it: needs a root cause
  await page.getByLabel('Move status').selectOption('in_progress');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.locator('dd', { hasText: 'in_progress' })).toBeVisible();
  await page.getByLabel('Move status').selectOption('resolved');
  await expect(page.getByRole('button', { name: 'Save status' })).toBeDisabled();
  await page.getByLabel('Root cause (required)').selectOption('process_gap');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.locator('dd', { hasText: 'resolved' })).toBeVisible();
  await expect(page.locator('.timeline')).toContainText('resolved');

  // dashboard
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Case dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
  await expectAccessible(page, 'dashboard');
});

test('an administrator sees the configuration screens', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-admin');
  await expect(page.getByRole('heading', { name: 'Queue members' })).toBeVisible();
  for (const heading of ['Assignment rules', 'Escalation rules', 'Intake channels', 'Regulatory profiles', 'Workflows', 'Integration events', 'SLA policies', 'Business hours', 'Message templates']) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expectAccessible(page, 'administration');
});

test('an auditor sees the integrity status and can search the audit trail', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-auditor');
  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('heading', { name: 'Audit trail integrity' })).toBeVisible();
  await page.getByRole('button', { name: 'Full re-verification' }).click();
  await expect(page.getByText('Chain verified')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Action starts with').fill('ticket.');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await expectAccessible(page, 'audit console');
});
