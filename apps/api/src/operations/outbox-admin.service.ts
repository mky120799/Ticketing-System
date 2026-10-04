import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';

/**
 * Operations on the integration outbox: see what could not be delivered and put it back in the queue once the cause is fixed
 * (for example the bank's bus was down). Administrator only; events hold minimized IDs, and each replay is audited.
 */
@Injectable()
export class OutboxAdminService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService) {}

  async summary(user: UserContext): Promise<Record<string, number>> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ status: string; n: string }>('SELECT status, count(*)::text AS n FROM integration_outbox GROUP BY status');
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.n)]));
  }

  async list(user: UserContext, status: string, limit: number): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!['pending', 'in_flight', 'retry', 'dead_letter', 'published'].includes(status)) throw new ConflictException('Unknown status');
    const rows = await this.db.query<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string; attempts: number; last_error: string | null; created_at: Date; next_attempt_at: Date }>(
      'SELECT id,event_type,aggregate_type,aggregate_id,attempts,last_error,created_at,next_attempt_at FROM integration_outbox WHERE status=$1 ORDER BY created_at DESC LIMIT $2', [status, Math.min(Math.max(limit, 1), 200)]);
    return rows.rows.map((r) => ({ id: r.id, eventType: r.event_type, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, attempts: r.attempts, lastError: r.last_error, createdAt: r.created_at, nextAttemptAt: r.next_attempt_at }));
  }

  /** Returns dead-lettered events to the queue with a fresh retry budget. With no id, replays up to 500, optionally of one event type. */
  async replay(user: UserContext, correlationId: string, options: { id?: string; eventType?: string }): Promise<{ replayed: number }> {
    this.policy.assertPermission(user, 'configuration:write');
    return this.db.transaction(async (client) => {
      const result = options.id
        ? await client.query("UPDATE integration_outbox SET status='retry', attempts=0, next_attempt_at=now(), last_error=NULL, claimed_at=NULL WHERE id=$1 AND status='dead_letter' RETURNING id", [options.id])
        : await client.query("UPDATE integration_outbox SET status='retry', attempts=0, next_attempt_at=now(), last_error=NULL, claimed_at=NULL WHERE id IN (SELECT id FROM integration_outbox WHERE status='dead_letter' AND ($1::text IS NULL OR event_type=$1) ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED) RETURNING id", [options.eventType ?? null]);
      if (options.id && !result.rowCount) throw new NotFoundException('That event is not in the dead-letter queue');
      await this.audit.write(client, { actorId: user.subject, action: 'outbox.replayed', targetType: 'outbox', targetId: options.id ?? 'dead-letter-batch', correlationId, outcome: 'success', metadata: { count: result.rowCount ?? 0, eventType: options.eventType ?? null } });
      return { replayed: result.rowCount ?? 0 };
    });
  }
}
