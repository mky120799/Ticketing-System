import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PgService } from '../database/pg.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';

export const RETENTION_ACTOR = 'system:retention';
const BATCH = 100;

/**
 * Enforces retention: de-identifies tickets whose retention period has ended and that are not under legal hold.
 * (Privacy Act APP 11.2: destroy or de-identify personal information that is no longer needed.)
 *
 * What is removed: subject, description, custom fields, note bodies, reference values, recipient references,
 * attachment names and the stored files. What is kept: the ticket skeleton (IDs, category, dates, status, outcome,
 * root cause) for statistics, and the immutable audit trail, which holds no free text by design.
 * Effective retention date = a supervisor-set date if present, otherwise closed_at + the category's retention years.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  constructor(private readonly db: PgService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly storage: AttachmentStorageService) {}

  async run(correlationId: string): Promise<{ redacted: number }> {
    const candidates = await this.db.query<{ id: string }>(
      `SELECT t.id FROM tickets t JOIN ticket_categories c ON c.category_key=t.category LEFT JOIN ticket_retention_controls rc ON rc.ticket_id=t.id
       WHERE t.status IN ('closed','cancelled') AND t.redacted_at IS NULL AND t.closed_at IS NOT NULL AND COALESCE(rc.legal_hold,false)=false
         AND COALESCE(rc.retention_until, t.closed_at + (c.retention_years * interval '1 year')) <= now()
       ORDER BY t.closed_at LIMIT ${BATCH}`);
    let redacted = 0;
    for (const { id } of candidates.rows) { try { if (await this.redact(id, correlationId)) redacted++; } catch (error) { this.logger.error(`Retention failed for a ticket: ${error instanceof Error ? error.message : 'unknown error'}`); } }
    return { redacted };
  }

  private async redact(ticketId: string, correlationId: string): Promise<boolean> {
    // Files first: object deletion is idempotent, so a failure here leaves the ticket to be retried next run.
    const files = await this.db.query<{ object_key: string }>('SELECT object_key FROM attachments WHERE ticket_id=$1', [ticketId]);
    for (const file of files.rows) await this.storage.deleteObject(file.object_key);
    return this.db.transaction(async (client) => {
      // Re-check under lock: a supervisor may have placed a hold, or the ticket been reopened, since the candidate query.
      const row = (await client.query<{ status: string; redacted_at: Date | null; legal_hold: boolean | null }>('SELECT t.status,t.redacted_at,rc.legal_hold FROM tickets t LEFT JOIN ticket_retention_controls rc ON rc.ticket_id=t.id WHERE t.id=$1 FOR UPDATE OF t', [ticketId])).rows[0];
      if (!row || row.redacted_at || row.legal_hold || !['closed', 'cancelled'].includes(row.status)) return false;
      await client.query("UPDATE tickets SET subject='[redacted]', description='[redacted]', custom_fields='{}'::jsonb, redacted_at=now(), updated_at=now() WHERE id=$1", [ticketId]);
      await client.query("UPDATE ticket_notes SET body='[redacted]' WHERE ticket_id=$1", [ticketId]);
      await client.query("UPDATE ticket_references SET opaque_reference='[redacted]', masked_value='••••' WHERE ticket_id=$1", [ticketId]);
      await client.query("UPDATE ticket_communications SET recipient_reference='[redacted]', recipient_masked='••••' WHERE ticket_id=$1", [ticketId]);
      await client.query("UPDATE attachments SET original_filename='[redacted]', checksum_sha256=NULL WHERE ticket_id=$1", [ticketId]);
      await this.audit.write(client, { actorId: RETENTION_ACTOR, action: 'ticket.redacted', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { attachmentsDeleted: files.rows.length } });
      await this.outbox.enqueue(client, { eventType: 'ticket.redacted', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId } });
      return true;
    });
  }
}
