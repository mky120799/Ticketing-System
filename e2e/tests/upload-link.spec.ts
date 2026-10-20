import { expect, test } from '@playwright/test';
import { ImapFlow } from 'imapflow';
import { STAFF, expectAccessible, signIn } from './helpers';

/** Reads the newest message to an address from the test mail server (mailbox login = the address). */
async function latestMessage(address: string, subjectPart: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const client = new ImapFlow({ host: 'localhost', port: 3143, secure: false, auth: { user: address, pass: address }, logger: false });
    try {
      await client.connect(); const lock = await client.getMailboxLock('INBOX');
      try { for await (const message of client.fetch('1:*', { envelope: true, source: true })) if ((message.envelope?.subject ?? '').includes(subjectPart)) return message.source.toString('utf8'); } finally { lock.release(); }
    } catch { /* the mailbox does not exist until the first message arrives */ } finally { await client.logout().catch(() => undefined); }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No message with "${subjectPart}" arrived for ${address}`);
}
const decodeQuotedPrintable = (text: string) => text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

test('staff send a secure upload link and a caller with no account uses it', async ({ page, browser }) => {
  const caller = `caller-${Date.now()}@example.test`;
  await signIn(page, STAFF, /Sign in with SSO/, 'local-supervisor');
  await expect(page.getByRole('heading', { name: 'Case workspace' })).toBeVisible();

  const subject = `Link test ticket ${Date.now()}`;
  const form = page.locator('section.create form');
  await form.getByLabel('category').fill('service-request'); await form.getByLabel('queue').fill('customer-support');
  await form.getByLabel('branch Code').fill('BLR-01'); await form.getByLabel('department').fill('operations');
  await form.getByLabel('legal Entity').fill('BANK-IN'); await form.getByLabel('country').fill('IN');
  await form.getByLabel('subject').fill(subject); await form.getByLabel('source System').fill('CRM'); await form.getByLabel('opaque Reference').fill('opaque-customer-5678');
  await form.getByLabel('description').fill('A caller needs to send identity documents.');
  await form.getByRole('button', { name: 'Create ticket' }).click();
  await expect(page.getByRole('heading', { name: subject })).toBeVisible();

  // ask for documents: the secure link is created with the message
  await page.getByLabel('Template').selectOption('email:document_request_email');
  await page.getByLabel('Recipient reference').fill(`mailto:${caller}`);
  await page.getByRole('button', { name: 'Queue communication' }).click();
  await expect(page.getByText('document_request_email')).toBeVisible();

  // the caller opens the link from the email, in a browser with no session
  const email = decodeQuotedPrintable(await latestMessage(caller, 'Please send us your documents'));
  const link = /http:\/\/localhost:5174\/upload#[A-Za-z0-9._-]+/.exec(email)?.[0];
  expect(link, 'the email contains the secure link').toBeTruthy();
  const context = await browser.newContext(); const customer = await context.newPage();
  await customer.goto(link!);
  await expect(customer.getByRole('heading', { name: 'Send documents to the bank' })).toBeVisible();
  await expect(customer.getByText(/You can send 5 more documents/)).toBeVisible();
  await expectAccessible(customer, 'secure upload page');
  await customer.getByLabel('Choose a document').setInputFiles({ name: 'passport.txt', mimeType: 'text/plain', buffer: Buffer.from('A browser test document.') });
  await customer.getByRole('button', { name: 'Send document' }).click();
  await expect(customer.getByText(/Your document has been sent/)).toBeVisible();
  await expect(customer.locator('.documents li').first()).toContainText('passport.txt');
  await expect(customer.getByText(/You can send 4 more documents/)).toBeVisible();

  // a damaged link shows a plain refusal, never any detail
  const damaged = await context.newPage();
  await damaged.goto('http://localhost:5174/upload#not-a-real-link');
  await expect(damaged.getByText(/not valid or has expired/)).toBeVisible();
  await context.close();
});
