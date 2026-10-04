import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { IntegrationService } from '../integrations/integration.service.js';
import { CONTACT_RESOLVER, type ContactResolver } from './contact-resolver.js';
import { renderMessage } from './message-template.js';

const PROVIDER: UserContext = { subject: 'system:email-delivery', roles: ['notification-provider'], branch: '', queues: [], department: '', legalEntity: '', country: '', serviceIdentity: true };
const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;

interface Due { id: string; ticket_id: string; channel: string; recipient_reference: string; delivery_attempts: number; status: string; subject_template: string | null; body_template: string | null; communications_blocked: boolean; }

/**
 * Sends queued customer communications. Email goes through SMTP; SMS through an HTTP gateway if SMS_GATEWAY_URL is set.
 * Recipients are resolved through the contact resolver (the bank's CRM owns contact data). Each attempt takes a short
 * lease so several instances never send the same message; failures retry with backoff and finally record a failed
 * delivery receipt. Results are recorded through the same receipt state machine an external provider would use.
 */
@Injectable()
export class DeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private transporter: Transporter | null = null;

  constructor(private readonly db: PgService, private readonly integration: IntegrationService, @Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolver) {}

  onModuleInit(): void {
    if (!process.env.DATABASE_URL || this.channels().length === 0) return;
    this.logger.log(`Delivery worker started (${this.channels().join(', ')})`);
    this.schedule(2000);
  }
  onModuleDestroy(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.transporter?.close(); }

  /** One pass; exposed for tests. Returns how many messages were handled. */
  async runOnce(): Promise<number> {
    const channels = this.channels();
    if (!channels.length) return 0;
    const due = await this.db.transaction(async (client) => {
      const rows = await client.query<Due>(`SELECT c.id,c.ticket_id,c.channel,c.recipient_reference,c.delivery_attempts,c.status,tpl.subject_template,tpl.body_template,t.communications_blocked
        FROM ticket_communications c JOIN communication_templates tpl ON tpl.template_key=c.template_key JOIN tickets t ON t.id=c.ticket_id
        WHERE c.status='queued' AND c.channel = ANY($1::text[]) AND c.next_attempt_at <= now() AND t.redacted_at IS NULL
        ORDER BY c.created_at LIMIT 10 FOR UPDATE OF c SKIP LOCKED`, [channels]);
      for (const row of rows.rows) await client.query("UPDATE ticket_communications SET delivery_attempts=delivery_attempts+1, next_attempt_at=now() + ($1 * interval '1 second'), updated_at=now() WHERE id=$2", [LEASE_SECONDS, row.id]);
      return rows.rows;
    });
    for (const communication of due) await this.deliver(communication);
    return due.length;
  }

  /** Channels this deployment can deliver. The portal is internal: the customer reads the message there, so it counts as delivered. */
  private channels(): string[] { return [process.env.SMTP_HOST ? 'email' : null, process.env.SMS_GATEWAY_URL ? 'sms' : null, process.env.PORTAL_OIDC_ISSUER ? 'portal' : null].filter((c): c is string => Boolean(c)); }

  private async deliver(c: Due): Promise<void> {
    const attempt = c.delivery_attempts + 1;
    try {
      if (c.communications_blocked) return await this.fail(c.id, 'COMMUNICATION_BLOCKED', 'Customer communications are blocked on this case');
      const ticket = (await this.db.query<{ status: string }>('SELECT status FROM tickets WHERE id=$1', [c.ticket_id])).rows[0];
      if (!ticket || !c.subject_template || !c.body_template) return await this.fail(c.id, 'TEMPLATE_INCOMPLETE', 'Template has no subject or body');
      const message = renderMessage(c.subject_template, c.body_template, c.ticket_id, ticket.status);
      if (c.channel === 'portal') {
        await this.record(c.id, 'portal', `portal-${c.id}`, 'sent');
        await this.record(c.id, 'portal', `portal-${c.id}-visible`, 'delivered');
      } else if (c.channel === 'email') {
        const address = await this.contacts.resolveEmail(c.recipient_reference);
        if (!address) return await this.fail(c.id, 'NO_CONTACT', 'No email address could be resolved for the recipient reference');
        const info = await this.mailer().sendMail({ from: process.env.MAIL_FROM ?? 'cases@localhost', to: address, subject: message.subject, text: message.text, html: message.html, headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', 'X-Case-Reference': message.subject.match(/\[(CASE-[A-Z0-9]+)\]/)?.[1] ?? '' } });
        await this.record(c.id, 'smtp', info.messageId || randomUUID(), 'sent');
      } else {
        const number = await this.contacts.resolveMobile(c.recipient_reference);
        if (!number) return await this.fail(c.id, 'NO_CONTACT', 'No mobile number could be resolved for the recipient reference');
        const response = await fetch(process.env.SMS_GATEWAY_URL!, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.SMS_GATEWAY_TOKEN ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_TOKEN}` } : {}) }, body: JSON.stringify({ to: number, message: message.text.slice(0, 320) }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`SMS gateway returned ${response.status}`);
        const body = (await response.json().catch(() => ({}))) as { id?: string };
        await this.record(c.id, 'sms-gateway', body.id ?? randomUUID(), 'sent');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 190) : 'delivery error';
      this.logger.warn(`Delivery attempt ${attempt} failed for a communication: ${reason}`);
      if (attempt >= MAX_ATTEMPTS) await this.fail(c.id, 'DELIVERY_FAILED', reason);
      else await this.db.query("UPDATE ticket_communications SET last_error=$1, next_attempt_at=now() + ($2 * interval '1 second') WHERE id=$3", [reason, Math.min(3600, 30 * 2 ** (attempt - 1)), c.id]);
    }
  }

  private async record(communicationId: string, provider: string, providerMessageId: string, status: 'sent' | 'delivered' | 'failed', failureCode?: string): Promise<void> {
    await this.integration.recordCommunicationReceipt(PROVIDER, communicationId, { provider, providerMessageId, status, ...(failureCode ? { failureCode } : {}) }, `delivery-${communicationId}`);
  }
  private async fail(communicationId: string, failureCode: string, reason: string): Promise<void> {
    await this.db.query('UPDATE ticket_communications SET last_error=$1 WHERE id=$2', [reason.slice(0, 190), communicationId]);
    await this.record(communicationId, 'delivery-worker', `failed-${communicationId}`, 'failed', failureCode);
  }

  private mailer(): Transporter {
    this.transporter ??= createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === 'true', ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}), ...(process.env.SMTP_ALLOW_INSECURE_TLS === 'true' ? { tls: { rejectUnauthorized: false } } : {}) });
    return this.transporter;
  }
  private schedule(delayMs: number): void { if (this.stopped) return; this.timer = setTimeout(() => { void this.tick(); }, delayMs); this.timer.unref(); }
  private async tick(): Promise<void> { try { await this.runOnce(); } catch (error) { this.logger.error(`Delivery pass failed: ${error instanceof Error ? error.message : 'unknown error'}`); } this.schedule(Number(process.env.DELIVERY_POLL_MS ?? 5000)); }
}
