import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { LiveEventsService, type LiveTicket } from '../live/live-events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { WorkflowDefinitionService } from '../workflow/workflow-definition.service.js';

export type ReplyChannel = 'email' | 'portal';

/**
 * Adds a customer's own message to their ticket. Shared by email and portal so both behave identically: the message is
 * stored as customer-visible text authored by the customer, it does NOT count as a staff response (so it cannot stop an
 * SLA clock), a ticket waiting on the customer moves back to in progress when the workflow allows, and the people
 * working the case are told. The caller is responsible for proving the sender owns the ticket.
 */
@Injectable()
export class CustomerReplyService {
  constructor(private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly live: LiveEventsService, private readonly notifications: NotificationsService, private readonly workflows: WorkflowDefinitionService) {}

  async add(client: PoolClient, ticketId: string, body: string, channel: ReplyChannel): Promise<void> {
    const ticket = (await client.query<LiveTicket & { category: string; redacted_at: Date | null }>('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [ticketId])).rows[0];
    if (!ticket) throw new NotFoundException('Request not found');
    if (ticket.redacted_at || ticket.status === 'cancelled') throw new ConflictException('This request can no longer receive messages');
    const author = `customer:${channel}`; const correlationId = `${channel}-reply-${randomUUID()}`;
    await client.query("INSERT INTO ticket_notes (id,ticket_id,visibility,body,author_id) VALUES ($1,$2,'customer',$3,$4)", [randomUUID(), ticketId, (body || '(empty message)').slice(0, 10_000), author]);
    if (ticket.status === 'pending_customer') {
      try {
        await this.workflows.assertTransition(client, ticket.category, 'pending_customer', 'in_progress', ['intake-gateway']);
        await client.query("UPDATE tickets SET status='in_progress', updated_at=now() WHERE id=$1", [ticketId]);
        await client.query(`UPDATE tickets SET first_response_due_at = first_response_due_at + (now() - sla_paused_at), resolution_due_at = resolution_due_at + (now() - sla_paused_at), sla_paused_at = NULL WHERE id=$1 AND sla_paused_at IS NOT NULL`, [ticketId]);
        await client.query('INSERT INTO ticket_status_history (id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), ticketId, 'pending_customer', 'in_progress', `Customer replied by ${channel}`, author]);
      } catch { /* the category's workflow does not allow it; leave the status alone */ }
    } else await client.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [ticketId]);
    await this.audit.write(client, { actorId: author, action: 'ticket.customer_replied', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { channel } });
    await this.outbox.enqueue(client, { eventType: 'ticket.customer_replied', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, channel } });
    const refreshed = (await client.query<LiveTicket & { assigned_to: string | null; legal_entity: string; country: string }>('SELECT * FROM tickets WHERE id=$1', [ticketId])).rows[0];
    await this.live.notify(client, 'ticket.note_added', refreshed);
    await this.notifications.ticketAttention(client, refreshed as unknown as { id: string; queue: string; assigned_to: string | null; legal_entity: string; country: string }, 'customer_replied', 'The customer replied', { assignee: true, supervisors: refreshed.status === 'resolved' || refreshed.status === 'closed' });
  }
}
