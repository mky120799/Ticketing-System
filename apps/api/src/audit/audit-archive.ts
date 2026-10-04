import { createHash } from 'node:crypto';
import { mkdirSync, createWriteStream, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from 'pg';
import { computeEventHashV2 } from './audit-hash.js';

export interface ArchiveResult { count: number; throughSequence: number; lastEventHash: string; file: string; manifest: string; sha256: string; }
interface Row { sequence: string; id: string; occurred_at: Date; actor_id: string; action: string; target_type: string; target_id: string; correlation_id: string; outcome: string; metadata: Record<string, unknown>; previous_hash: string | null; event_hash: string; hash_version: number; }

/**
 * Moves old audit events out of the live table without breaking verification. Run by the schema OWNER (the runtime
 * account cannot delete audit events), never by the application. In one transaction it:
 *   1. re-verifies the events being archived (links and, for version 2, recomputed hashes) - it refuses to archive a trail that is already damaged;
 *   2. writes them to a JSON-lines file with a manifest containing the file's SHA-256 (store both in write-once storage);
 *   3. records the newest archived event as the chain's new base;
 *   4. deletes them, with the append-only triggers switched off for this transaction only.
 * If anything fails the transaction rolls back and the triggers are intact. Keep at least the latest events: archiving everything is refused.
 */
export async function archiveAuditEvents(options: { connectionString: string; throughSequence: number; outDir: string; archivedBy: string; note?: string }): Promise<ArchiveResult> {
  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const head = (await client.query<{ max: string | null }>('SELECT max(sequence)::text AS max FROM audit_events')).rows[0].max;
    if (!head || options.throughSequence >= Number(head)) throw new Error('Refusing to archive: at least the newest audit event must remain in the live table');
    const base = (await client.query<{ sequence: string; event_hash: string }>('SELECT sequence,event_hash FROM audit_chain_bases ORDER BY sequence DESC LIMIT 1')).rows[0];
    if (base && options.throughSequence <= Number(base.sequence)) throw new Error('Nothing to archive: that range is already behind the current base');
    mkdirSync(options.outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(options.outDir, `audit-archive-${stamp}-through-${options.throughSequence}.jsonl`);
    const out = createWriteStream(file); const hash = createHash('sha256');
    let expectedPrevious: string | null = base?.event_hash ?? null; let count = 0; let last = ''; let cursor = base ? Number(base.sequence) : 0;
    for (;;) {
      const rows = (await client.query<Row>('SELECT sequence,id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash,hash_version FROM audit_events WHERE sequence > $1 AND sequence <= $2 ORDER BY sequence LIMIT 5000', [cursor, options.throughSequence])).rows;
      if (!rows.length) break;
      for (const row of rows) {
        if (row.previous_hash !== expectedPrevious) throw new Error(`Refusing to archive: the chain is broken at sequence ${row.sequence}`);
        if (row.hash_version >= 2 && computeEventHashV2({ id: row.id, occurredAt: row.occurred_at, actorId: row.actor_id, action: row.action, targetType: row.target_type, targetId: row.target_id, correlationId: row.correlation_id, outcome: row.outcome, metadata: row.metadata, previousHash: row.previous_hash }) !== row.event_hash) throw new Error(`Refusing to archive: event ${row.sequence} does not match its hash`);
        const line = `${JSON.stringify({ ...row, occurred_at: row.occurred_at.toISOString() })}\n`;
        hash.update(line); if (!out.write(line)) await once(out, 'drain');
        expectedPrevious = row.event_hash; last = row.event_hash; cursor = Number(row.sequence); count++;
      }
    }
    out.end(); await once(out, 'finish');
    if (!count) throw new Error('Nothing to archive in that range');
    const sha256 = hash.digest('hex'); const manifest = `${file}.manifest.json`;
    writeFileSync(manifest, JSON.stringify({ throughSequence: cursor, events: count, lastEventHash: last, previousBaseHash: base?.event_hash ?? null, file: file.split('/').pop(), sha256, archivedAt: new Date().toISOString(), archivedBy: options.archivedBy }, null, 2));
    await client.query('INSERT INTO audit_chain_bases (sequence,event_hash,archived_events,archive_sha256,archive_location,note,archived_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [cursor, last, count, sha256, file.slice(-300), options.note ?? null, options.archivedBy]);
    await client.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
    await client.query('DELETE FROM audit_events WHERE sequence <= $1', [cursor]);
    await client.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
    await client.query('COMMIT');
    return { count, throughSequence: cursor, lastEventHash: last, file, manifest, sha256 };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { await client.end(); }
}

/**
 * Last resort for a trail whose first events are already missing (for example a development database that was reset
 * badly). Records the existing start as the accepted base so verification can proceed. This is a deliberate human
 * decision: it accepts that history before this point cannot be verified.
 */
export async function acceptExistingStart(options: { connectionString: string; archivedBy: string }): Promise<{ sequence: number }> {
  const client = new Client({ connectionString: options.connectionString }); await client.connect();
  try {
    const first = (await client.query<{ sequence: string; previous_hash: string | null }>('SELECT sequence,previous_hash FROM audit_events ORDER BY sequence LIMIT 1')).rows[0];
    if (!first || first.previous_hash === null) throw new Error('The trail starts at its genesis event; nothing to accept');
    const sequence = Number(first.sequence) - 1;
    await client.query("INSERT INTO audit_chain_bases (sequence,event_hash,archived_events,note,archived_by) VALUES ($1,$2,0,'Accepted existing start (earlier events unavailable)',$3)", [sequence, first.previous_hash, options.archivedBy]);
    return { sequence };
  } finally { await client.end(); }
}
