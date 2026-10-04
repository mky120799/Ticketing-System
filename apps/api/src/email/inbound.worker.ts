import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { AuditService } from '../audit/audit.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { IntakeService } from '../intake/intake.service.js';
import { CustomerReplyService } from '../intake/customer-reply.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

const ACTOR = 'system:email-intake';
const ADAPTER: UserContext = { subject: ACTOR, roles: ['intake-gateway'], branch: '', queues: [], department: '', legalEntity: '', country: '', serviceIdentity: true };
const NO_REPLY_SENDERS = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce|bounces|notifications?)([+._-].*)?$/i;

/**
 * Turns incoming email into tickets, or into replies on an existing ticket.
 *
 * Protections: automatic mail (auto-replies, bounces, bulk and list mail) and our own address are ignored so two
 * automated systems cannot loop; senders are rate limited per hour; the sender is stored only as a keyed pseudonym
 * (HMAC), never the raw address, except in the reply-address reference needed to answer them; a reply is attached to a
 * ticket only if its sender is the person who raised it. Quoted history is cut so the same text is not stored repeatedly.
 * Attachments are not imported (the ticket says how many were dropped).
 */
@Injectable()
export class InboundEmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundEmailWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly db: PgService, private readonly intake: IntakeService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly replies: CustomerReplyService) {}

  onModuleInit(): void {
    if (!process.env.IMAP_HOST || !process.env.EMAIL_REFERENCE_SECRET || !process.env.DATABASE_URL) return;
    this.logger.log(`Inbound email worker started (${process.env.IMAP_HOST})`);
    this.schedule(3000);
  }
  onModuleDestroy(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }

  /** One pass over unread mail; exposed for tests. Returns how many messages were processed (including ignored ones). */
  async runOnce(): Promise<number> {
    const client = new ImapFlow({ host: process.env.IMAP_HOST!, port: Number(process.env.IMAP_PORT ?? 993), secure: process.env.IMAP_SECURE !== 'false', auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! }, logger: false, ...(process.env.IMAP_ALLOW_INSECURE_TLS === 'true' ? { tls: { rejectUnauthorized: false } } : {}) });
    let processed = 0;
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of uids.slice(0, 20)) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) continue;
        try { await this.handle(await simpleParser(message.source), message.source); await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); processed++; }
        catch (error) { this.logger.warn(`Could not process a message, will retry: ${error instanceof Error ? error.message : 'unknown error'}`); }
      }
    } finally { lock.release(); await client.logout().catch(() => undefined); }
    return processed;
  }

  private async handle(mail: ParsedMail, source: Buffer): Promise<void> {
    const sender = mail.from?.value[0]?.address?.toLowerCase();
    if (!sender || this.isAutomatic(mail, sender)) { this.logger.log('Ignored an automatic or sender-less message'); return; }
    const reference = `EMAIL-${createHmac('sha256', process.env.EMAIL_REFERENCE_SECRET!).update(sender).digest('hex').slice(0, 24)}`;
    const limit = Number(process.env.EMAIL_MAX_TICKETS_PER_SENDER_HOUR ?? 5);
    const recent = Number((await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM tickets t JOIN ticket_references r ON r.ticket_id=t.id WHERE t.source_channel='email' AND r.opaque_reference=$1 AND t.created_at > now() - interval '1 hour'", [reference])).rows[0].n);
    const subject = (mail.subject ?? '(no subject)').trim().slice(0, 200) || '(no subject)';
    const body = this.cleanBody(mail) + (mail.attachments.length ? `\n\n[${mail.attachments.length} attachment(s) were not imported]` : '');
    const thread = /\[CASE-([0-9A-F]{8})\]/i.exec(subject);
    if (thread && (await this.addReply(thread[1].toLowerCase(), reference, body))) return;
    if (recent >= limit) { this.logger.warn('Sender exceeded the hourly ticket limit; message ignored'); return; }
    const messageId = (mail.messageId ?? `generated-${createHash('sha256').update(source).digest('hex').slice(0, 40)}`).replace(/[^\x21-\x7e]/g, '').slice(0, 200);
    const created = await this.intake.create(ADAPTER, 'email', { messageId, senderReference: reference, subject, body: body || '(empty message)' }, `email-${randomUUID()}`);
    if (process.env.EMAIL_AUTO_ACK !== 'false') await this.acknowledge(created.ticketId, sender);
  }

  private isAutomatic(mail: ParsedMail, sender: string): boolean {
    const header = (name: string) => String(mail.headers.get(name) ?? '').toLowerCase();
    const autoSubmitted = header('auto-submitted');
    if ((autoSubmitted && autoSubmitted !== 'no') || ['bulk', 'junk', 'list', 'auto_reply'].includes(header('precedence')) || mail.headers.has('x-auto-response-suppress') || mail.headers.has('list-id') || mail.headers.has('x-autoreply') || header('content-type').includes('multipart/report')) return true;
    const ourAddress = (process.env.MAIL_FROM ?? '').match(/<?([^<>\s]+@[^<>\s]+)>?$/)?.[1]?.toLowerCase();
    return NO_REPLY_SENDERS.test(sender.split('@')[0]) || sender === ourAddress;
  }

  private cleanBody(mail: ParsedMail): string {
    let text = mail.text ?? (mail.html ? mail.html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '');
    const quoted = text.search(/^(On .{5,200} wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\nSent: )/im);
    if (quoted > 0) text = text.slice(0, quoted);
    return text.split('\n').filter((line) => !line.startsWith('>')).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20_000);
  }

  /** Attaches a reply to its ticket if (and only if) the sender is the person who raised it. */
  private async addReply(shortId: string, reference: string, body: string): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const ticket = (await client.query<{ id: string }>('SELECT t.id FROM tickets t WHERE t.id::text LIKE $1 AND t.redacted_at IS NULL AND EXISTS (SELECT 1 FROM ticket_references r WHERE r.ticket_id=t.id AND r.opaque_reference=$2) LIMIT 1', [`${shortId}%`, reference])).rows[0];
      if (!ticket) return false;
      await this.replies.add(client, ticket.id, body, 'email');
      return true;
    });
  }

  /** Queues the standard acknowledgement to the address the customer wrote from, unless one exists or communications are blocked. */
  private async acknowledge(ticketId: string, address: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const ticket = (await client.query<{ communications_blocked: boolean }>('SELECT communications_blocked FROM tickets WHERE id=$1 FOR UPDATE', [ticketId])).rows[0];
      const existing = await client.query('SELECT 1 FROM ticket_communications WHERE ticket_id=$1 LIMIT 1', [ticketId]);
      if (!ticket || ticket.communications_blocked || existing.rowCount) return;
      const id = randomUUID(); const correlationId = `email-ack-${id}`;
      const masked = `${'•'.repeat(4)}${address.slice(address.indexOf('@') - 1)}`;
      await client.query("INSERT INTO ticket_communications (id,ticket_id,channel,template_key,recipient_reference,recipient_masked,created_by,status) VALUES ($1,$2,'email','ticket_acknowledgement',$3,$4,$5,'queued')", [id, ticketId, `mailto:${address}`, masked, ACTOR]);
      await client.query('UPDATE tickets SET first_responded_at=COALESCE(first_responded_at, now()) WHERE id=$1', [ticketId]);
      await this.audit.write(client, { actorId: ACTOR, action: 'customer_communication.queued', targetType: 'communication', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, channel: 'email', templateKey: 'ticket_acknowledgement' } });
      await this.outbox.enqueue(client, { eventType: 'customer_communication.queued', aggregateType: 'communication', aggregateId: id, correlationId, payload: { communicationId: id, ticketId, channel: 'email', templateKey: 'ticket_acknowledgement', status: 'queued' } });
    });
  }

  private schedule(delayMs: number): void { if (this.stopped) return; this.timer = setTimeout(() => { void this.tick(); }, delayMs); this.timer.unref(); }
  private async tick(): Promise<void> { try { await this.runOnce(); } catch (error) { this.logger.error(`Inbound email pass failed: ${error instanceof Error ? error.message : 'unknown error'}`); } this.schedule(Number(process.env.IMAP_POLL_MS ?? 15_000)); }
}
