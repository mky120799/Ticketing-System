import { expect, test } from '@playwright/test';
import { STAFF, createTicket, expectAccessible, signIn } from './helpers';

test('login screen is accessible', async ({ page }) => {
  await page.goto(STAFF);
  await expect(page.getByRole('heading', { name: 'Bank Case Platform' })).toBeVisible();
  await expectAccessible(page, 'staff sign-in page');
});

test('a deep link survives sign-in', async ({ page }) => {
  // Opening /dashboard while signed out should land on /dashboard after signing in (returnTo through OIDC state).
  await page.goto(`${STAFF}/dashboard`);
  await page.getByRole('button', { name: /Sign in with SSO/ }).click();
  await page.locator('#username').fill('local-supervisor'); await page.locator('#password').fill('local-dev-only-change-me'); await page.locator('#kc-login').click();
  await expect(page).toHaveURL(`${STAFF}/dashboard`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('a supervisor works a ticket through its life', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-supervisor');
  await expect(page).toHaveURL(`${STAFF}/tickets`);
  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expectAccessible(page, 'ticket queue');

  // create a ticket through the dialog; it opens on its own page
  const subject = `Browser test ticket ${Date.now()}`;
  await createTicket(page, { subject, description: 'Created by the browser test.', reference: 'opaque-customer-1234' });
  await expect(page.getByText('••••')).toBeVisible(); // references are masked
  await expectAccessible(page, 'case screen');

  // the case has its own URL: a refresh keeps it open
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();

  // people are shown by name, not by their identity-provider ID
  await expect(page.getByText('Created by Local Supervisor')).toBeVisible();
  await page.getByRole('button', { name: 'Assign' }).click();
  const assign = page.getByRole('dialog', { name: 'Assign ticket' });
  await assign.getByRole('button', { name: 'Assign to me' }).click();
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(assign).toBeHidden();
  await expect(page.getByText('Assigned to Local Supervisor')).toBeVisible(); // confirmation toast
  const details = page.locator('.mantine-Paper-root', { has: page.getByRole('heading', { name: 'Details' }) });
  await expect(details.getByText('Local Supervisor')).toBeVisible(); // the Assignee field

  // add an internal note
  await page.getByRole('textbox', { name: 'Add an internal note' }).fill('Checked the customer record.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.locator('.activity-timeline')).toContainText('Checked the customer record.');

  // move to in progress, then resolve (resolving needs a root cause)
  await page.getByRole('button', { name: 'Change status' }).click();
  let dialog = page.getByRole('dialog', { name: 'Change status' });
  await dialog.getByLabel('New status').selectOption('in_progress');
  await dialog.getByRole('button', { name: 'Save status' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.activity-timeline')).toContainText('In progress');

  await page.getByRole('button', { name: 'Change status' }).click();
  dialog = page.getByRole('dialog', { name: 'Change status' });
  await dialog.getByLabel('New status').selectOption('resolved');
  await expect(dialog.getByRole('button', { name: 'Save status' })).toBeDisabled();
  await dialog.getByLabel('Root cause (required)').selectOption('process_gap');
  await dialog.getByRole('button', { name: 'Save status' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.activity-timeline')).toContainText('Resolved');
  await expect(page.getByText('Root cause: Process gap')).toBeVisible();

  // back to the queue: the ticket is listed under "All" (resolved tickets leave the "Open" view)
  await page.getByRole('link', { name: 'Back to tickets' }).click();
  await page.getByText(/^All \(/).click();
  await expect(page.getByRole('link', { name: subject })).toBeVisible();

  // dashboard
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible();
  await expectAccessible(page, 'dashboard');
});

test('an administrator sees the configuration screens', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-admin');
  // administrators have no case access, so they start in Administration
  await expect(page).toHaveURL(`${STAFF}/admin/routing`);
  for (const heading of ['Queue members', 'Assignment rules', 'Escalation rules']) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expectAccessible(page, 'administration: routing');

  const sections: [string, string[]][] = [
    ['Intake channels', ['Intake channels']],
    ['Service levels', ['SLA policies', 'Business hours']],
    ['Compliance', ['Regulatory profiles', 'Public holidays']],
    ['Workflows', ['Workflows']],
    ['Message templates', ['Message templates']],
    ['Integration events', ['Integration events']]
  ];
  for (const [tab, headings] of sections) {
    await page.getByRole('tab', { name: tab }).click();
    for (const heading of headings) await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
  }
  await expectAccessible(page, 'administration: integration events');
  await expect(page.getByRole('link', { name: 'Tickets' })).toHaveCount(0);
});

test('an auditor sees the integrity status and can search the audit trail', async ({ page }) => {
  await signIn(page, STAFF, /Sign in with SSO/, 'local-auditor');
  await page.getByRole('link', { name: 'Audit' }).click();
  await expect(page.getByRole('heading', { name: 'Audit trail integrity' })).toBeVisible();
  await page.getByRole('button', { name: 'Full re-verification' }).click();
  await expect(page.getByText('Chain verified')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Action starts with').fill('ticket.');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await expectAccessible(page, 'audit console');
  // auditors read but never change: no "New ticket" button in the queue
  await page.getByRole('link', { name: 'Tickets' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New ticket' })).toHaveCount(0);
});
