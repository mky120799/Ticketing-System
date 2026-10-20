import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export const RESOLUTION_NOTICE_ACTOR = 'system:resolution-notice';
const EMAIL_TEMPLATE = 'resolution_notice';
const PORTAL_TEMPLATE = 'resolution_notice_portal';

export interface NoticeTicket { id: string; category: string; source_channel: string; communications_blocked: boolean; redacted_at: Date | null; queue: string; assigned_to: string | null; legal_entity: string; country: string; }

const mask = (value: string): string => (value.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`);

/**
 * Tells the customer their request was resolved, as part of the same transaction that resolves it, so a resolved ticket
 * can never exist without the notice having been queued (or a recorded reason why not). The notice is an ordinary
 * governed communication: the template decides whether a supervisor must approve it, it honours the communication block
 * (tipping-off control), and delivery, retries and receipts are the normal delivery path.
 *
 * Where it goes: a portal customer gets a portal message; an email customer is answered at the address they wrote from
 * (kept on the acknowledgement); every other channel uses the customer reference, which the bank's CRM resolves.
 */
@Injectable()
export class ResolutionNoticeService {
  constructor(private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly notifications: NotificationsService) {}

  async queue(client: PoolClient, ticket: NoticeTicket, correlationId: string): Promise<{ queued: boolean; reason?: string }> {
    const category = (await client.query<{ resolution_notice_enabled: boolean }>('SELECT resolution_notice_enabled FROM ticket_categories WHERE category_key=$1', [ticket.category])).rows[0];
    if (!category?.resolution_notice_enabled) return { queued: false, reason: 'disabled_for_category' };
    if (ticket.redacted_at) return { queued: false, reason: 'redacted' };
    if (ticket.communications_blocked) return this.skipped(client, ticket, 'communications_blocked', correlationId);

    const channel = ticket.source_channel === 'portal' ? 'portal' : 'email';
    const templateKey = channel === 'portal' ? PORTAL_TEMPLATE : EMAIL_TEMPLATE;
    const template = (await client.query<{ requires_approval: boolean }>('SELECT requires_approval FROM communication_templates WHERE template_key=$1 AND channel=$2 AND active=true', [templateKey, channel])).rows[0];
    if (!template) return this.skipped(client, ticket, 'template_inactive', correlationId);

    const pending = await client.query("SELECT 1 FROM ticket_communications WHERE ticket_id=$1 AND template_key=$2 AND status IN ('pending_approval','queued') LIMIT 1", [ticket.id, templateKey]);
    if (pending.rowCount) return { queued: false, reason: 'already_pending' };

    const recipient = await this.recipient(client, ticket, channel);
    if (!recipient) return this.skipped(client, ticket, 'no_recipient', correlationId);

    const id = randomUUID();
    const status = template.requires_approval ? 'pending_approval' : 'queued';
    await client.query('INSERT INTO ticket_communications (id,ticket_id,channel,template_key,recipient_reference,recipient_masked,created_by,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, ticket.id, channel, templateKey, recipient, mask(recipient), RESOLUTION_NOTICE_ACTOR, status]);
    await this.audit.write(client, { actorId: RESOLUTION_NOTICE_ACTOR, action: status === 'queued' ? 'customer_communication.queued' : 'customer_communication.approval_requested', targetType: 'communication', targetId: id, correlationId, outcome: 'success', metadata: { ticketId: ticket.id, channel, templateKey, status, automatic: true } });
    if (status === 'pending_approval') {
      const approvalId = randomUUID(); const actionType = `customer_communication:${templateKey}`;
      await client.query('INSERT INTO approval_requests (id,ticket_id,communication_id,action_type,requested_by) VALUES ($1,$2,$3,$4,$5)', [approvalId, ticket.id, id, actionType, RESOLUTION_NOTICE_ACTOR]);
      await this.audit.write(client, { actorId: RESOLUTION_NOTICE_ACTOR, action: 'approval.requested', targetType: 'approval', targetId: approvalId, correlationId, outcome: 'success', metadata: { ticketId: ticket.id, communicationId: id, actionType } });
      await this.outbox.enqueue(client, { eventType: 'approval.requested', aggregateType: 'approval', aggregateId: approvalId, correlationId, payload: { approvalId, ticketId: ticket.id, communicationId: id, actionType } });
      await this.notifications.ticketAttention(client, ticket, 'approval_needed', 'A resolution notice is waiting for approval', { assignee: false, supervisors: true });
    }
    await this.outbox.enqueue(client, { eventType: status === 'queued' ? 'customer_communication.queued' : 'customer_communication.pending_approval', aggregateType: 'communication', aggregateId: id, correlationId, payload: { communicationId: id, ticketId: ticket.id, channel, templateKey, status } });
    return { queued: true };
  }

  private async recipient(client: PoolClient, ticket: NoticeTicket, channel: string): Promise<string | null> {
    if (channel === 'portal') return (await client.query<{ opaque_reference: string }>("SELECT opaque_reference FROM ticket_references WHERE ticket_id=$1 AND opaque_reference LIKE 'PORTAL-%' LIMIT 1", [ticket.id])).rows[0]?.opaque_reference ?? null;
    if (ticket.source_channel === 'email') {
      // The sender reference on an email ticket is a one-way pseudonym; the address itself is only kept on the acknowledgement.
      const mailto = (await client.query<{ recipient_reference: string }>("SELECT recipient_reference FROM ticket_communications WHERE ticket_id=$1 AND channel='email' AND recipient_reference LIKE 'mailto:%' ORDER BY created_at LIMIT 1", [ticket.id])).rows[0];
      return mailto?.recipient_reference ?? null;
    }
    return (await client.query<{ opaque_reference: string }>('SELECT opaque_reference FROM ticket_references WHERE ticket_id=$1 ORDER BY id LIMIT 1', [ticket.id])).rows[0]?.opaque_reference ?? null;
  }

  private async skipped(client: PoolClient, ticket: NoticeTicket, reason: string, correlationId: string): Promise<{ queued: boolean; reason: string }> {
    await this.audit.write(client, { actorId: RESOLUTION_NOTICE_ACTOR, action: 'customer_communication.resolution_notice_skipped', targetType: 'ticket', targetId: ticket.id, correlationId, outcome: 'success', metadata: { reason } });
    // Nobody will tell the customer unless a person does, so the people responsible are told.
    if (reason !== 'communications_blocked') await this.notifications.ticketAttention(client, ticket, 'approval_needed', 'No resolution notice could be sent; contact the customer directly', { assignee: true, supervisors: true });
    return { queued: false, reason };
  }
}
