import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../database/pg.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';
import { AuditService } from './audit.service.js';
import { computeEventHashV2 } from './audit-hash.js';

export const AUDIT_INTEGRITY_ACTOR = 'system:audit-integrity';
const BATCH = 5000;

export interface VerificationResult { status: 'valid' | 'invalid'; verifiedThroughSequence: number; headHash: string | null; eventsChecked: number; legacyEvents: number; failureSequence?: number; failureReason?: string; verifiedAt: string; }
interface Row { sequence: string; id: string; occurred_at: Date; actor_id: string; action: string; target_type: string; target_id: string; correlation_id: string; outcome: string; metadata: Record<string, unknown>; previous_hash: string | null; event_hash: string; hash_version: number; }

/**
 * Proves the audit trail has not been altered, and publishes copies of the chain head.
 *
 * Verification walks events in order from the last valid checkpoint and checks (1) every event points at the hash of
 * the one before it, (2) for version-2 events the hash recomputes from the stored fields, including the timestamp, and
 * (3) every previously published anchor still matches the event it was taken from. (3) is what catches deletion of
 * the newest events, which linkage alone cannot see. Version-1 events (written before timestamps were hashed) are
 * link-checked only and counted as `legacyEvents`.
 */
@Injectable()
export class AuditIntegrityService {
  private readonly logger = new Logger(AuditIntegrityService.name);
  constructor(private readonly db: PgService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly storage: AttachmentStorageService) {}

  /**
   * Incremental by default (resumes after the last valid checkpoint, so it is cheap to run hourly). Incremental runs cannot
   * see changes to events that were already verified, so `full` re-walks the entire trail; the daily run uses it.
   */
  async verify(full = false): Promise<VerificationResult> {
    const last = full ? undefined : (await this.db.query<{ verified_through_sequence: string; head_hash: string | null }>("SELECT verified_through_sequence,head_hash FROM audit_verifications WHERE status='valid' ORDER BY id DESC LIMIT 1")).rows[0];
    let cursor = last ? Number(last.verified_through_sequence) : 0; let expectedPrevious = last?.head_hash ?? null;
    let checked = 0; let legacy = 0; let headHash = expectedPrevious; let failure: { sequence: number; reason: string } | null = null;
    for (;;) {
      const rows = (await this.db.query<Row>('SELECT sequence,id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash,hash_version FROM audit_events WHERE sequence > $1 ORDER BY sequence LIMIT $2', [cursor, BATCH])).rows;
      if (!rows.length) break;
      for (const row of rows) {
        const sequence = Number(row.sequence);
        if (row.previous_hash !== expectedPrevious) { failure = { sequence, reason: 'Chain link broken: an earlier event was removed or altered' }; break; }
        if (row.hash_version >= 2) {
          const recomputed = computeEventHashV2({ id: row.id, occurredAt: row.occurred_at, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, correlationId: row.correlation_id, outcome: row.outcome, metadata: row.metadata, previousHash: row.previous_hash });
          if (recomputed !== row.event_hash) { failure = { sequence, reason: 'Event content does not match its recorded hash' }; break; }
        } else legacy++;
        expectedPrevious = row.event_hash; headHash = row.event_hash; cursor = sequence; checked++;
      }
      if (failure) break;
    }
    failure ??= await this.checkAnchors();
    const result: VerificationResult = { status: failure ? 'invalid' : 'valid', verifiedThroughSequence: cursor, headHash, eventsChecked: checked, legacyEvents: legacy, ...(failure ? { failureSequence: failure.sequence, failureReason: failure.reason } : {}), verifiedAt: new Date().toISOString() };
    await this.db.query('INSERT INTO audit_verifications (status,verified_through_sequence,head_hash,events_checked,legacy_events,failure_sequence,failure_reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [result.status, cursor, headHash, checked, legacy, failure?.sequence ?? null, failure?.reason ?? null]);
    if (failure) this.logger.error(`AUDIT INTEGRITY FAILURE at sequence ${failure.sequence}: ${failure.reason}`);
    return result;
  }

  async latest(): Promise<{ verification: VerificationResult | null; lastAnchor: { sequence: number; headHash: string; createdAt: string } | null }> {
    const v = (await this.db.query<{ status: 'valid' | 'invalid'; verified_through_sequence: string; head_hash: string | null; events_checked: string; legacy_events: string; failure_sequence: string | null; failure_reason: string | null; verified_at: Date }>('SELECT status,verified_through_sequence,head_hash,events_checked,legacy_events,failure_sequence,failure_reason,verified_at FROM audit_verifications ORDER BY id DESC LIMIT 1')).rows[0];
    const a = (await this.db.query<{ sequence: string; head_hash: string; created_at: Date }>('SELECT sequence,head_hash,created_at FROM audit_anchors ORDER BY sequence DESC LIMIT 1')).rows[0];
    return {
      verification: v ? { status: v.status, verifiedThroughSequence: Number(v.verified_through_sequence), headHash: v.head_hash, eventsChecked: Number(v.events_checked), legacyEvents: Number(v.legacy_events), ...(v.failure_sequence ? { failureSequence: Number(v.failure_sequence), failureReason: v.failure_reason ?? undefined } : {}), verifiedAt: v.verified_at.toISOString() } : null,
      lastAnchor: a ? { sequence: Number(a.sequence), headHash: a.head_hash, createdAt: a.created_at.toISOString() } : null
    };
  }

  async listAnchors(limit = 50): Promise<unknown[]> {
    const result = await this.db.query<{ sequence: string; head_hash: string; object_key: string | null; created_at: Date }>('SELECT sequence,head_hash,object_key,created_at FROM audit_anchors ORDER BY sequence DESC LIMIT $1', [Math.min(Math.max(limit, 1), 200)]);
    return result.rows.map((r) => ({ sequence: Number(r.sequence), headHash: r.head_hash, storedExternally: Boolean(r.object_key), createdAt: r.created_at }));
  }

  /**
   * Publishes the current chain head outside the database: an outbox event (to the bank's bus / SIEM) and, if object
   * storage is configured, a JSON object (use a bucket with Object Lock for write-once retention). Only anchors a head
   * that has just verified clean, and only if the chain has grown since the last anchor.
   */
  async anchor(correlationId: string): Promise<{ anchored: boolean; sequence?: number }> {
    const verification = await this.verify(true);
    if (verification.status !== 'valid' || !verification.headHash || verification.verifiedThroughSequence === 0) return { anchored: false };
    const lastAnchor = (await this.db.query<{ sequence: string }>('SELECT sequence FROM audit_anchors ORDER BY sequence DESC LIMIT 1')).rows[0];
    if (lastAnchor && Number(lastAnchor.sequence) >= verification.verifiedThroughSequence) return { anchored: false };
    const sequence = verification.verifiedThroughSequence; const headHash = verification.headHash; const createdAt = new Date().toISOString();
    const objectKey = await this.storage.putJson(`audit-anchors/${String(sequence).padStart(12, '0')}.json`, { sequence, headHash, anchoredAt: createdAt }).catch(() => null);
    await this.db.transaction(async (client) => {
      await client.query('INSERT INTO audit_anchors (sequence,head_hash,object_key) VALUES ($1,$2,$3) ON CONFLICT (sequence) DO NOTHING', [sequence, headHash, objectKey]);
      await this.audit.write(client, { actorId: AUDIT_INTEGRITY_ACTOR, action: 'audit.anchor_created', targetType: 'audit_chain', targetId: 'chain', correlationId, outcome: 'success', metadata: { sequence, headHash, storedExternally: Boolean(objectKey) } });
      await this.outbox.enqueue(client, { eventType: 'audit.anchor_created', aggregateType: 'audit_chain', aggregateId: 'chain', correlationId, payload: { sequence, headHash } });
    });
    return { anchored: true, sequence };
  }

  private async checkAnchors(): Promise<{ sequence: number; reason: string } | null> {
    const mismatches = await this.db.query<{ sequence: string }>('SELECT a.sequence FROM audit_anchors a LEFT JOIN audit_events e ON e.sequence=a.sequence WHERE e.event_hash IS DISTINCT FROM a.head_hash ORDER BY a.sequence LIMIT 1');
    return mismatches.rows[0] ? { sequence: Number(mismatches.rows[0].sequence), reason: 'A published anchor no longer matches the audit trail: events were deleted or rewritten' } : null;
  }
}
