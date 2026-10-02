import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export const ASSIGNMENT_ACTOR = 'system:assignment-rules';
const OPEN_STATUS_SQL = "('resolved','closed','cancelled')";

/**
 * Applies configured assignment rules to a newly created ticket.
 * A rule picks a strategy (least_loaded or round_robin); the strategy picks one active member of the ticket's queue.
 * Tickets with no matching rule, or a queue with no active members, simply stay unassigned in the queue.
 */
@Injectable()
export class AssignmentService {
  constructor(private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async autoAssign(client: PoolClient, ticket: { id: string; queue: string; category: string; priority: string; status: string }, correlationId: string): Promise<string | null> {
    // Serialize assignment decisions per queue so concurrent creations cannot all pick the same "least loaded" member.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`assign:${ticket.queue}`]);
    const rule = (await client.query<{ rule_key: string; strategy: string }>(
      `SELECT rule_key, strategy FROM assignment_rules WHERE queue_key=$1 AND active=true AND (category IS NULL OR category=$2) AND (priority IS NULL OR priority=$3)
       ORDER BY (category IS NOT NULL) DESC, (priority IS NOT NULL) DESC, sort_order, rule_key LIMIT 1`, [ticket.queue, ticket.category, ticket.priority])).rows[0];
    if (!rule) return null;
    // ORDER BY text comes from this fixed pair, never from input.
    const order = rule.strategy === 'round_robin' ? 'm.last_assigned_at NULLS FIRST, m.user_id' : 'open_count, m.last_assigned_at NULLS FIRST, m.user_id';
    const member = (await client.query<{ user_id: string }>(
      `SELECT m.user_id, (SELECT count(*) FROM tickets t WHERE t.queue=m.queue_key AND t.assigned_to=m.user_id AND t.status NOT IN ${OPEN_STATUS_SQL}) AS open_count
       FROM queue_members m WHERE m.queue_key=$1 AND m.active=true ORDER BY ${order} LIMIT 1`, [ticket.queue])).rows[0];
    if (!member) return null;
    await client.query('UPDATE tickets SET assigned_to=$1, status=$2, updated_at=now() WHERE id=$3', [member.user_id, 'assigned', ticket.id]);
    await client.query('UPDATE queue_members SET last_assigned_at=now() WHERE queue_key=$1 AND user_id=$2', [ticket.queue, member.user_id]);
    await client.query('INSERT INTO ticket_status_history (id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), ticket.id, ticket.status, 'assigned', `Auto-assigned by rule ${rule.rule_key} (${rule.strategy})`, ASSIGNMENT_ACTOR]);
    await this.audit.write(client, { actorId: ASSIGNMENT_ACTOR, action: 'ticket.auto_assigned', targetType: 'ticket', targetId: ticket.id, correlationId, outcome: 'success', metadata: { ruleKey: rule.rule_key, strategy: rule.strategy, queue: ticket.queue } });
    await this.outbox.enqueue(client, { eventType: 'ticket.assigned', aggregateType: 'ticket', aggregateId: ticket.id, correlationId, payload: { ticketId: ticket.id, queue: ticket.queue, assigneeId: member.user_id, mode: 'auto', ruleKey: rule.rule_key } });
    return member.user_id;
  }
}
