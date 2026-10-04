import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PgService } from '../database/pg.service.js';
import { LiveEventsService, type LiveTicket } from '../live/live-events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export const ESCALATION_ACTOR = 'system:escalation';
const PRIORITY_STEP: Record<string, string> = { low: 'normal', normal: 'high', high: 'critical', critical: 'critical' };
// First response = the first customer-facing action (customer note, queued communication, pending-customer or resolve).
const TRIGGER_SQL: Record<string, string> = {
  first_response_overdue: "t.status NOT IN ('resolved','closed','cancelled') AND t.first_responded_at IS NULL AND t.first_response_due_at <= now()",
  regulatory_ack_overdue: "t.regulatory_profile IS NOT NULL AND t.status NOT IN ('resolved','closed','cancelled') AND t.regulatory_status='ack_overdue'",
  regulatory_at_risk: "t.regulatory_profile IS NOT NULL AND t.status NOT IN ('resolved','closed','cancelled') AND t.regulatory_status IN ('at_risk','final_response_overdue')",
  regulatory_breached: "t.regulatory_profile IS NOT NULL AND t.status NOT IN ('resolved','closed','cancelled') AND t.regulatory_status='final_response_overdue'",
  breached: "t.status NOT IN ('resolved','closed','cancelled') AND t.sla_paused_at IS NULL AND t.resolution_due_at <= now()"
};
const BATCH_PER_RULE = 100;

interface Rule { rule_key: string; queue_key: string; trigger: string; escalate_to_queue: string; raise_priority: boolean; }

/**
 * Moves SLA-overdue tickets along configured escalation paths. Runs as a system actor (no user session).
 * Idempotent: ticket_escalations has UNIQUE(ticket_id, rule_key), so a ticket escalates at most once per rule
 * no matter how many timer ticks or API instances evaluate it. Each ticket is handled in its own transaction.
 */
@Injectable()
export class EscalationService {
  constructor(private readonly db: PgService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly live: LiveEventsService, private readonly notifications: NotificationsService) {}

  async run(correlationId: string): Promise<{ escalated: number }> {
    const rules = (await this.db.query<Rule>('SELECT rule_key,queue_key,trigger,escalate_to_queue,raise_priority FROM escalation_rules WHERE active=true ORDER BY rule_key')).rows;
    let escalated = 0;
    for (const rule of rules) {
      const candidates = await this.db.query<{ id: string }>(
        `SELECT t.id FROM tickets t, case_queues target WHERE t.queue=$1 AND target.queue_key=$2 AND t.legal_entity=target.legal_entity AND t.country=target.country
           AND ${TRIGGER_SQL[rule.trigger]} AND NOT EXISTS (SELECT 1 FROM ticket_escalations e WHERE e.ticket_id=t.id AND e.rule_key=$3)
         ORDER BY t.created_at LIMIT ${BATCH_PER_RULE}`, [rule.queue_key, rule.escalate_to_queue, rule.rule_key]);
      for (const { id } of candidates.rows) if (await this.escalateOne(id, rule, correlationId)) escalated++;
    }
    return { escalated };
  }

  private escalateOne(ticketId: string, rule: Rule, correlationId: string): Promise<boolean> {
    return this.db.transaction(async (client) => {
      // Re-read under a row lock: a person may have moved or resolved the ticket since the candidate query.
      const ticket = (await client.query<LiveTicket & { priority: string }>('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [ticketId])).rows[0];
      if (!ticket || ticket.queue !== rule.queue_key) return false;
      const claimed = await client.query('INSERT INTO ticket_escalations (id,ticket_id,rule_key,trigger,from_queue,to_queue) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id', [randomUUID(), ticketId, rule.rule_key, rule.trigger, rule.queue_key, rule.escalate_to_queue]);
      if (!claimed.rowCount) return false;
      const priority = rule.raise_priority ? PRIORITY_STEP[ticket.priority] ?? ticket.priority : ticket.priority;
      const updated = (await client.query<LiveTicket>('UPDATE tickets SET queue=$1, status=$2, assigned_to=NULL, priority=$3, updated_at=now() WHERE id=$4 RETURNING *', [rule.escalate_to_queue, 'escalated', priority, ticketId])).rows[0];
      await client.query('INSERT INTO ticket_status_history (id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), ticketId, ticket.status, 'escalated', `SLA ${rule.trigger}; escalation rule ${rule.rule_key}`, ESCALATION_ACTOR]);
      await this.audit.write(client, { actorId: ESCALATION_ACTOR, action: 'ticket.escalated', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { ruleKey: rule.rule_key, trigger: rule.trigger, fromQueue: rule.queue_key, toQueue: rule.escalate_to_queue, priority } });
      await this.outbox.enqueue(client, { eventType: 'ticket.escalated', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, ruleKey: rule.rule_key, trigger: rule.trigger, fromQueue: rule.queue_key, toQueue: rule.escalate_to_queue, priority } });
      await this.live.notify(client, 'ticket.escalated', updated, rule.queue_key);
      await this.notifications.ticketAttention(client, updated as unknown as { id: string; queue: string; assigned_to: string | null; legal_entity: string; country: string }, 'ticket_escalated', 'A ticket was escalated to your queue', { assignee: false, supervisors: true });
      if (ticket.assigned_to) await this.notifications.create(client, { user: ticket.assigned_to, legalEntity: ticket.legal_entity, country: ticket.country }, 'ticket_escalated', 'A ticket you were working was escalated', ticketId);
      return true;
    });
  }
}
