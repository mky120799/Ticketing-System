import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../database/pg.service.js';
import { PolicyService } from '../auth/policy.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { UserContext } from '../auth/user-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { addBusinessMinutes } from '../compliance/business-calendar.js';
import { LiveEventsService, type LiveTicket } from '../live/live-events.service.js';

export const SLA_TIMER_ACTOR = 'system:sla-timer';
/**
 * SLA status from actual-or-now against each deadline: breached if resolution (or "now" while unresolved) is past due;
 * first_response_overdue if the first customer response was (or still is) late; met once resolved in time; else running.
 */
export const NEXT_SLA_STATUS_SQL = "CASE WHEN sla_paused_at IS NOT NULL THEN 'paused' WHEN COALESCE(resolved_at, now()) > resolution_due_at THEN 'breached' WHEN COALESCE(first_responded_at, now()) > first_response_due_at THEN 'first_response_overdue' WHEN resolved_at IS NOT NULL THEN 'met' ELSE 'running' END";

export interface SlaWindow { policyKey: string; firstResponseDueAt: Date; resolutionDueAt: Date; }

@Injectable()
export class SlaService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly live: LiveEventsService, private readonly notifications: NotificationsService) {}

  /**
   * First-response and resolution deadlines for a new ticket. A policy counts either wall-clock minutes (the default) or
   * working minutes inside the country's business hours, skipping weekends and public holidays.
   */
  async calculate(client: PoolClient, priority: string, now = new Date(), country?: string): Promise<SlaWindow> {
    const result = await client.query<{ first_response_minutes: number; resolution_minutes: number; calendar: string }>('SELECT first_response_minutes, resolution_minutes, calendar FROM sla_policies WHERE policy_key=$1 AND priority=$2 AND active=true', ['default', priority]);
    const policy = result.rows[0];
    if (!policy) throw new ConflictException(`No active SLA policy exists for priority ${priority}`);
    if (policy.calendar === 'business' && country) {
      const hours = (await client.query<{ timezone: string; start_minute: number; end_minute: number; working_days: number[] }>('SELECT timezone,start_minute,end_minute,working_days FROM business_hours WHERE country=$1', [country])).rows[0];
      if (hours) {
        const holidays = new Set((await client.query<{ d: string }>("SELECT to_char(holiday_date,'YYYY-MM-DD') AS d FROM business_holidays WHERE country=$1", [country])).rows.map((r) => r.d));
        const schedule = { timeZone: hours.timezone, startMinute: hours.start_minute, endMinute: hours.end_minute, workingDays: hours.working_days };
        return { policyKey: 'default', firstResponseDueAt: addBusinessMinutes(now, policy.first_response_minutes, schedule, holidays), resolutionDueAt: addBusinessMinutes(now, policy.resolution_minutes, schedule, holidays) };
      }
    }
    return { policyKey: 'default', firstResponseDueAt: new Date(now.getTime() + policy.first_response_minutes * 60_000), resolutionDueAt: new Date(now.getTime() + policy.resolution_minutes * 60_000) };
  }

  /** Stops the SLA clock when a ticket starts waiting on the customer, if its policy says so. Call before the status update. */
  async pauseIfConfigured(client: PoolClient, ticket: { id: string; sla_policy_key: string | null; priority: string; status: string }, toStatus: string): Promise<void> {
    if (toStatus !== 'pending_customer' || ticket.status === 'pending_customer') return;
    const policy = (await client.query<{ pause: boolean }>('SELECT pause_while_pending_customer AS pause FROM sla_policies WHERE policy_key=$1 AND priority=$2', [ticket.sla_policy_key, ticket.priority])).rows[0];
    if (policy?.pause) await client.query('UPDATE tickets SET sla_paused_at=COALESCE(sla_paused_at, now()) WHERE id=$1', [ticket.id]);
  }

  /** Restarts a paused clock and moves the deadlines out by the time spent waiting, so waiting on the customer never counts against the bank. */
  async resumeIfPaused(client: PoolClient, ticketId: string): Promise<void> {
    await client.query(`UPDATE tickets SET first_response_due_at = first_response_due_at + (now() - sla_paused_at), resolution_due_at = resolution_due_at + (now() - sla_paused_at), sla_paused_at = NULL WHERE id=$1 AND sla_paused_at IS NOT NULL`, [ticketId]);
  }

  async reconcile(user: UserContext, correlationId: string): Promise<{ updated: number; statuses: Record<string, number> }> {
    this.policy.assertPermission(user, 'sla:reconcile');
    return this.db.transaction(async (client) => {
      const administrator = user.roles.includes('administrator');
      const result = administrator
        ? await client.query<{ id: string; sla_status: string }>(`UPDATE tickets SET sla_status=${NEXT_SLA_STATUS_SQL}, updated_at=now()
            WHERE legal_entity=$1 AND country=$2 AND status NOT IN ('closed','cancelled')
              AND sla_status IS DISTINCT FROM ${NEXT_SLA_STATUS_SQL}
            RETURNING id,sla_status`, [user.legalEntity, user.country])
        : await client.query<{ id: string; sla_status: string }>(`UPDATE tickets SET sla_status=${NEXT_SLA_STATUS_SQL}, updated_at=now()
            WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) AND status NOT IN ('closed','cancelled')
              AND sla_status IS DISTINCT FROM ${NEXT_SLA_STATUS_SQL}
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
        if (row.sla_status === 'breached' || row.sla_status === 'first_response_overdue') await this.notifications.ticketAttention(client, row, 'sla_at_risk', row.sla_status === 'breached' ? 'A ticket has breached its resolution deadline' : 'A ticket has passed its first-response deadline');
      }
      return { updated: result.rows.length };
    });
  }
}
