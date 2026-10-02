import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export interface AuditInput { actorId: string; action: string; targetType: string; targetId: string; correlationId: string; outcome: 'success' | 'denied'; metadata?: Record<string, string | number | boolean | null>; }

@Injectable()
export class AuditService {
  async write(client: PoolClient, input: AuditInput): Promise<void> {
    // Serialize the chain head within the surrounding business transaction.
    await client.query('SELECT pg_advisory_xact_lock($1)', [804231]);
    const previous = await client.query<{ event_hash: string }>('SELECT event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1');
    const previousHash = previous.rows[0]?.event_hash ?? null;
    const canonical = JSON.stringify({ ...input, metadata: input.metadata ?? {}, previousHash });
    const eventHash = createHash('sha256').update(canonical).digest('hex');
    await client.query(`INSERT INTO audit_events (id, actor_id, action, target_type, target_id, correlation_id, outcome, metadata, previous_hash, event_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), input.actorId, input.action, input.targetType, input.targetId, input.correlationId, input.outcome, JSON.stringify(input.metadata ?? {}), previousHash, eventHash]);
  }
}
