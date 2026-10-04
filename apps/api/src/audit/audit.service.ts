import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { computeEventHashV2 } from './audit-hash.js';
import { requestContext } from './request-context.js';
import { OutboxService } from '../outbox/outbox.service.js';

export interface AuditInput { actorId: string; action: string; targetType: string; targetId: string; correlationId: string; outcome: 'success' | 'denied'; metadata?: Record<string, string | number | boolean | null>; }

@Injectable()
export class AuditService {
  constructor(private readonly outbox: OutboxService) {}

  async write(client: PoolClient, input: AuditInput): Promise<void> {
    // Serialize the chain head within the surrounding business transaction.
    await client.query('SELECT pg_advisory_xact_lock($1)', [804231]);
    const previous = await client.query<{ event_hash: string }>('SELECT event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1');
    const previousHash = previous.rows[0]?.event_hash ?? null;
    const id = randomUUID(); const occurredAt = new Date();
    // Normalize exactly as the database will store it, so a later recomputation from the stored row matches.
    const context = requestContext.getStore();
    const metadata = JSON.parse(JSON.stringify({ ...(input.metadata ?? {}), ...(context?.ip ? { ctx_ip: context.ip } : {}), ...(context?.userAgent ? { ctx_ua: context.userAgent } : {}), ...(context?.tokenId ? { ctx_jti: context.tokenId } : {}), ...(context?.acr ? { ctx_acr: context.acr } : {}) })) as Record<string, unknown>;
    const eventHash = computeEventHashV2({ id, occurredAt, actorId: input.actorId, action: input.action, targetType: input.targetType, targetId: input.targetId, correlationId: input.correlationId, outcome: input.outcome, metadata, previousHash });
    await client.query(`INSERT INTO audit_events (id, occurred_at, actor_id, action, target_type, target_id, correlation_id, outcome, metadata, previous_hash, event_hash, hash_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,2)`, [id, occurredAt, input.actorId, input.action, input.targetType, input.targetId, input.correlationId, input.outcome, JSON.stringify(metadata), previousHash, eventHash]);
    // Optional live feed to the bank's SIEM through the outbox (same transaction, so it exists if and only if the event does).
    if (process.env.AUDIT_STREAM_ENABLED === 'true') {
      await this.outbox.enqueue(client, { eventType: 'audit.event', aggregateType: 'audit', aggregateId: id, correlationId: input.correlationId, payload: { eventId: id, occurredAt: occurredAt.toISOString(), actorId: input.actorId, action: input.action, targetType: input.targetType, targetId: input.targetId, outcome: input.outcome, eventHash, previousHash, hashVersion: 2, ...(process.env.AUDIT_STREAM_INCLUDE_METADATA === 'true' ? { metadata: JSON.stringify(metadata) } : {}) } });
    }
  }

  /**
   * The current state of a configuration row, as JSON text, to record next to its replacement ("before" value).
   * `table` and `where` are fixed strings written by the calling code, never user input.
   */
  async previous(client: PoolClient, table: string, where: string, values: unknown[]): Promise<string> {
    const row = (await client.query(`SELECT * FROM ${table} WHERE ${where}`, values)).rows[0] as Record<string, unknown> | undefined;
    if (!row) return 'none';
    delete row.updated_at; delete row.updated_by;
    return JSON.stringify(row).slice(0, 1500);
  }
}
