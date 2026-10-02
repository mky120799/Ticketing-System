import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { PgService } from '../database/pg.service.js';

export interface OutboxEvent { eventType: string; aggregateType: string; aggregateId: string; correlationId: string; payload: Record<string, string | number | boolean | null>; }
export interface OutboxRecord extends OutboxEvent { id: string; attempts: number; createdAt: Date; }
export interface OutboxPublisher { publish(event: OutboxRecord): Promise<void>; }

@Injectable()
export class OutboxService {
  constructor(private readonly db: PgService) {}

  async enqueue(client: PoolClient, event: OutboxEvent): Promise<void> {
    await client.query(`INSERT INTO integration_outbox (id,event_type,aggregate_type,aggregate_id,correlation_id,payload) VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), event.eventType, event.aggregateType, event.aggregateId, event.correlationId, JSON.stringify(event.payload)]);
  }

  async processBatch(publisher: OutboxPublisher, batchSize = 25): Promise<{ claimed: number; published: number; retried: number; deadLettered: number }> {
    const claimed = await this.db.transaction((client) => this.claim(client, batchSize));
    let published = 0; let retried = 0; let deadLettered = 0;
    for (const event of claimed) {
      try { await publisher.publish(event); await this.db.transaction((client) => this.markPublished(client, event.id)); published++; }
      catch { const status = await this.db.transaction((client) => this.markFailed(client, event.id, event.attempts)); if (status === 'dead_letter') deadLettered++; else retried++; }
    }
    return { claimed: claimed.length, published, retried, deadLettered };
  }

  /** Releases rows left 'in_flight' by a dispatcher that crashed after claiming them; they are retried (at-least-once). */
  async releaseStale(olderThanSeconds: number): Promise<number> {
    const result = await this.db.query(`UPDATE integration_outbox SET status='retry', next_attempt_at=now(), claimed_at=NULL WHERE status='in_flight' AND claimed_at < now() - ($1 * interval '1 second')`, [olderThanSeconds]);
    return result.rowCount ?? 0;
  }

  private async claim(client: PoolClient, batchSize: number): Promise<OutboxRecord[]> {
    const result = await client.query<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string; correlation_id: string; payload: Record<string, string | number | boolean | null>; attempts: number; created_at: Date }>(`WITH candidates AS (SELECT id FROM integration_outbox WHERE status IN ('pending','retry') AND next_attempt_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE integration_outbox AS o SET status='in_flight', claimed_at=now(), attempts=o.attempts+1 FROM candidates WHERE o.id=candidates.id RETURNING o.id,o.event_type,o.aggregate_type,o.aggregate_id,o.correlation_id,o.payload,o.attempts,o.created_at`, [Math.min(Math.max(batchSize, 1), 100)]);
    return result.rows.map((row) => ({ id: row.id, eventType: row.event_type, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, correlationId: row.correlation_id, payload: row.payload, attempts: row.attempts, createdAt: row.created_at }));
  }

  private async markPublished(client: PoolClient, id: string): Promise<void> { await client.query(`UPDATE integration_outbox SET status='published', published_at=now(), claimed_at=NULL WHERE id=$1 AND status='in_flight'`, [id]); }

  private async markFailed(client: PoolClient, id: string, attempts: number): Promise<'retry' | 'dead_letter'> {
    const deadLetter = attempts >= 5; const status = deadLetter ? 'dead_letter' : 'retry'; const delaySeconds = Math.min(3600, 2 ** Math.max(attempts - 1, 0));
    await client.query(`UPDATE integration_outbox SET status=$1, last_error=$2, next_attempt_at=now() + ($3 * interval '1 second') WHERE id=$4 AND status='in_flight'`, [status, 'publisher_failure', deadLetter ? 3600 : delaySeconds, id]);
    return status;
  }
}
