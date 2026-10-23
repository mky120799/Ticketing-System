import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const STAFF = 'http://localhost:5173'; export const PORTAL = 'http://localhost:5174';

/** Signs in through the real Keycloak login page. */
export async function signIn(page: Page, appUrl: string, button: string | RegExp, user: string): Promise<void> {
  await page.goto(appUrl);
  await page.getByRole('button', { name: button }).click();
  await page.locator('#username').fill(user); await page.locator('#password').fill('local-dev-only-change-me'); await page.locator('#kc-login').click();
  await page.waitForURL(`${appUrl}/**`);
}

/**
 * Creates a ticket through the staff console's "New ticket" dialog and waits for its case screen to open.
 * Branch, department, entity and country are filled from the signed-in profile, so the test does not type them.
 */
export async function createTicket(page: Page, ticket: { subject: string; description: string; reference: string }): Promise<void> {
  await page.getByRole('button', { name: 'New ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New ticket' });
  await dialog.getByLabel('Subject').fill(ticket.subject);
  await dialog.getByLabel('Description').fill(ticket.description);
  await dialog.getByLabel('Category').selectOption('service-request');
  await dialog.getByLabel('Queue').selectOption('customer-support');
  await dialog.getByLabel('Customer reference').fill(ticket.reference);
  await dialog.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByRole('heading', { level: 1, name: ticket.subject })).toBeVisible();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}/);
}

/** Fails on serious or critical accessibility violations (WCAG 2.1 A/AA rules). */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) - ${v.help} [${v.nodes.length} element(s)] e.g. ${v.nodes[0]?.html.slice(0, 120)}`), `Accessibility violations on ${label}`).toEqual([]);
}
