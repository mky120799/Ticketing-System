import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../database/pg.service.js';
import { PolicyService } from '../auth/policy.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { UserContext } from '../auth/user-context.js';
import { LiveEventsService, type LiveTicket } from '../live/live-events.service.js';

export const SLA_TIMER_ACTOR = 'system:sla-timer';
const NEXT_SLA_STATUS_SQL = "CASE WHEN resolution_due_at <= now() THEN 'breached' WHEN first_response_due_at <= now() THEN 'first_response_overdue' ELSE 'running' END";

export interface SlaWindow { policyKey: string; firstResponseDueAt: Date; resolutionDueAt: Date; }

@Injectable()
export class SlaService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly live: LiveEventsService) {}

  async calculate(client: PoolClient, priority: string, now = new Date()): Promise<SlaWindow> {
    const result = await client.query<{ first_response_minutes: number; resolution_minutes: number }>('SELECT first_response_minutes, resolution_minutes FROM sla_policies WHERE policy_key=$1 AND priority=$2 AND active=true', ['default', priority]);
    const policy = result.rows[0];
    if (!policy) throw new ConflictException(`No active SLA policy exists for priority ${priority}`);
    return { policyKey: 'default', firstResponseDueAt: new Date(now.getTime() + policy.first_response_minutes * 60_000), resolutionDueAt: new Date(now.getTime() + policy.resolution_minutes * 60_000) };
  }

  async reconcile(user: UserContext, correlationId: string): Promise<{ updated: number; statuses: Record<string, number> }> {
    this.policy.assertPermission(user, 'sla:reconcile');
    return this.db.transaction(async (client) => {
      const administrator = user.roles.includes('administrator');
      const result = administrator
        ? await client.query<{ id: string; sla_status: string }>(`UPDATE tickets SET sla_status=CASE WHEN resolution_due_at <= now() THEN 'breached' WHEN first_response_due_at <= now() THEN 'first_response_overdue' ELSE 'running' END, updated_at=now()
            WHERE legal_entity=$1 AND country=$2 AND status NOT IN ('closed','cancelled')
              AND sla_status IS DISTINCT FROM CASE WHEN resolution_due_at <= now() THEN 'breached' WHEN first_response_due_at <= now() THEN 'first_response_overdue' ELSE 'running' END
            RETURNING id,sla_status`, [user.legalEntity, user.country])
        : await client.query<{ id: string; sla_status: string }>(`UPDATE tickets SET sla_status=CASE WHEN resolution_due_at <= now() THEN 'breached' WHEN first_response_due_at <= now() THEN 'first_response_overdue' ELSE 'running' END, updated_at=now()
            WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) AND status NOT IN ('closed','cancelled')
              AND sla_status IS DISTINCT FROM CASE WHEN resolution_due_at <= now() THEN 'breached' WHEN first_response_due_at <= now() THEN 'first_response_overdue' ELSE 'running' END
            RETURNING id,sla_status`, [user.legalEntity, user.country, user.queues]);
      const statuses: Record<string, number> = {};
      for (const row of result.rows) {
        statuses[row.sla_status] = (statuses[row.sla_status] ?? 0) + 1;
        await this.audit.write(client, { actorId: user.subject, action: `ticket.sla_${row.sla_status}`, targetType: 'ticket', targetId: row.id, correlationId, outcome: 'success', metadata: { slaStatus: row.sla_status } });
        await this.outbox.enqueue(client, { eventType: 'ticket.sla_status_changed', aggregateType: 'ticket', aggregateId: row.id, correlationId, payload: { ticketId: row.id, slaStatus: row.sla_status } });
      }
      return { updated: result.rows.length, statuses };
    });
  }

  /**
   * Timer variant of reconcile: all scopes, system actor, bounded batch so one tick never holds a huge transaction.
   * Remaining tickets are picked up by the next tick.
   */
  async reconcileSystem(correlationId: string, batchSize = 500): Promise<{ updated: number }> {
    return this.db.transaction(async (client) => {
      const result = await client.query<LiveTicket & { sla_status: string }>(`UPDATE tickets SET sla_status=${NEXT_SLA_STATUS_SQL}, updated_at=now()
        WHERE id IN (SELECT id FROM tickets WHERE status NOT IN ('closed','cancelled') AND sla_status IS DISTINCT FROM ${NEXT_SLA_STATUS_SQL} ORDER BY updated_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING *`, [batchSize]);
      for (const row of result.rows) {
        await this.audit.write(client, { actorId: SLA_TIMER_ACTOR, action: `ticket.sla_${row.sla_status}`, targetType: 'ticket', targetId: row.id, correlationId, outcome: 'success', metadata: { slaStatus: row.sla_status } });
        await this.outbox.enqueue(client, { eventType: 'ticket.sla_status_changed', aggregateType: 'ticket', aggregateId: row.id, correlationId, payload: { ticketId: row.id, slaStatus: row.sla_status } });
        await this.live.notify(client, 'ticket.sla_changed', row);
      }
      return { updated: result.rows.length };
    });
  }
}
