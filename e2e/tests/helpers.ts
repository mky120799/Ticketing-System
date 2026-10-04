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

/** Fails on serious or critical accessibility violations (WCAG 2.1 A/AA rules). */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) - ${v.help} [${v.nodes.length} element(s)] e.g. ${v.nodes[0]?.html.slice(0, 120)}`), `Accessibility violations on ${label}`).toEqual([]);
}
