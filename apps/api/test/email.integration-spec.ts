import { createServer, type Server } from 'node:http';
import { ImapFlow } from 'imapflow';
import { createTransport } from 'nodemailer';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { DeliveryWorker } from '../src/email/delivery.worker.js';
import { InboundEmailWorker } from '../src/email/inbound.worker.js';

// Needs the mail server: EMAIL_TEST=1 docker compose --profile mail up -d mail
const run = process.env.EMAIL_TEST === '1';
(run ? describe : describe.skip)('email intake and delivery against a real mail server', () => {
  let app: NestFastifyApplication; let pool: Pool; let server: Server; let privateKey: KeyLike; let issuer: string;
  const smtp = () => createTransport({ host: 'localhost', port: 3025, secure: false, tls: { rejectUnauthorized: false } });
  const send = (from: string, subject: string, text: string, headers: Record<string, string> = {}) => smtp().sendMail({ from, to: 'cases@bank.test', subject, text, headers });
  beforeAll(async () => {
    Object.assign(process.env, { SMTP_HOST: 'localhost', SMTP_PORT: '3025', MAIL_FROM: 'cases@bank.test', IMAP_HOST: 'localhost', IMAP_PORT: '3143', IMAP_SECURE: 'false', IMAP_USER: 'cases', IMAP_PASSWORD: 'cases-secret', EMAIL_REFERENCE_SECRET: 'test-pseudonym-key', EMAIL_MAX_TICKETS_PER_SENDER_HOUR: '3' });
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => { if (req.url === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; } res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x');
    issuer = `http://127.0.0.1:${a.port}/realms/i`; process.env.OIDC_ISSUER = issuer; process.env.OIDC_AUDIENCE = 'bank-case-api'; process.env.OIDC_JWKS_URI = `http://127.0.0.1:${a.port}/jwks`;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init(); await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool?.end(); await app?.close(); await new Promise<void>((r) => server.close(() => r())); });
  const tok = (roles: string[], sub: string) => new SignJWT({ roles, branch: 'BLR-01', queues: ['customer-support', 'payments'], department: 'operations', legal_entity: 'BANK-IN', country: 'IN' }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(issuer).setAudience('bank-case-api').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const tickets = async () => (await pool.query("SELECT id,subject,status,source_channel FROM tickets WHERE source_channel='email' ORDER BY created_at")).rows;

  async function readMailbox(login: string, password: string): Promise<string[]> {
    const client = new ImapFlow({ host: 'localhost', port: 3143, secure: false, auth: { user: login, pass: password }, logger: false });
    await client.connect(); const lock = await client.getMailboxLock('INBOX'); const subjects: string[] = [];
    try { for await (const message of client.fetch('1:*', { envelope: true })) subjects.push(message.envelope?.subject ?? ''); } finally { lock.release(); await client.logout(); }
    return subjects;
  }

  it('creates a ticket from an email, acknowledges it, threads a reply, and ignores automatic mail', async () => {
    const admin = await tok(['administrator'], 'email-admin');
    expect((await app.inject({ method: 'PUT', url: '/v1/configuration/intake-channels/email', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, payload: { defaultCategory: 'service-request', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true } })).statusCode).toBe(200);
    const inbound = app.get(InboundEmailWorker); const delivery = app.get(DeliveryWorker);
    const before = (await tickets()).length;

    // 1. A customer email becomes a ticket with a pseudonymous sender and an acknowledgement queued.
    await send('alice@example.test', 'My card was swallowed', 'The ATM kept my card yesterday.\n\nRegards, Alice');
    expect(await inbound.runOnce()).toBe(1);
    const created = (await tickets()).slice(before); expect(created).toHaveLength(1); expect(created[0].subject).toBe('My card was swallowed');
    const ref = (await pool.query("SELECT opaque_reference FROM ticket_references WHERE ticket_id=$1", [created[0].id])).rows[0].opaque_reference as string;
    expect(ref).toMatch(/^EMAIL-[0-9a-f]{24}$/); expect(ref).not.toContain('alice');
    const ack = (await pool.query("SELECT status,recipient_reference FROM ticket_communications WHERE ticket_id=$1", [created[0].id])).rows[0]; expect(ack).toMatchObject({ status: 'queued', recipient_reference: 'mailto:alice@example.test' });
    expect((await pool.query('SELECT first_responded_at FROM tickets WHERE id=$1', [created[0].id])).rows[0].first_responded_at).not.toBeNull();

    // 2. The delivery worker sends the acknowledgement and records the receipt; the customer's mailbox shows it with the case reference.
    expect(await delivery.runOnce()).toBeGreaterThanOrEqual(1);
    expect((await pool.query('SELECT status FROM ticket_communications WHERE ticket_id=$1', [created[0].id])).rows[0].status).toBe('sent');
    const caseRef = `CASE-${created[0].id.slice(0, 8).toUpperCase()}`;
    expect((await readMailbox('alice@example.test', 'alice@example.test')).some((s) => s.includes(`[${caseRef}]`))).toBe(true);

    // 3. A reply quoting the reference is attached to the same ticket, with the quoted history removed; no new ticket.
    await pool.query("UPDATE tickets SET status='pending_customer' WHERE id=$1", [created[0].id]);
    await send('alice@example.test', `Re: We have received your request [${caseRef}]`, 'It was at the George Street ATM.\n\nOn Tue, 1 Oct 2026, Cases <cases@bank.test> wrote:\n> Thank you for contacting us.');
    await inbound.runOnce();
    expect(await tickets()).toHaveLength(before + 1);
    const notes = (await pool.query("SELECT body,author_id,visibility FROM ticket_notes WHERE ticket_id=$1", [created[0].id])).rows;
    expect(notes).toEqual([{ body: 'It was at the George Street ATM.', author_id: 'customer:email', visibility: 'customer' }]);
    expect((await pool.query('SELECT status FROM tickets WHERE id=$1', [created[0].id])).rows[0].status).toBe('in_progress');

    // 4. Someone else quoting that reference cannot add to the ticket; it becomes their own ticket instead.
    await send('mallory@example.test', `Re: hello [${caseRef}]`, 'I am a different person.');
    await inbound.runOnce();
    expect(await tickets()).toHaveLength(before + 2);
    expect((await pool.query("SELECT count(*)::int AS n FROM ticket_notes WHERE ticket_id=$1", [created[0].id])).rows[0].n).toBe(1);

    // 5. Automatic mail is ignored (no loops, no tickets).
    await send('robot@example.test', 'Out of office', 'I am away.', { 'Auto-Submitted': 'auto-replied' });
    await send('mailer-daemon@example.test', 'Undelivered Mail Returned to Sender', 'bounce');
    await send('news@example.test', 'Weekly newsletter', 'buy now', { Precedence: 'bulk' });
    await send('cases@bank.test', 'Our own address', 'loop');
    await inbound.runOnce();
    expect(await tickets()).toHaveLength(before + 2);

    // 6. A sender over the hourly limit is dropped.
    for (let i = 1; i <= 4; i++) await send('flood@example.test', `Flood ${i}`, `message ${i}`);
    await inbound.runOnce();
    expect((await tickets()).filter((t) => t.subject.startsWith('Flood'))).toHaveLength(3);
  }, 90_000);
});
