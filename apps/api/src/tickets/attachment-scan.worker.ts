import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgService } from '../database/pg.service.js';
import type { UserContext } from '../auth/user-context.js';
import { scanWithClamd } from '../storage/clamav.client.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';
import { TicketsService } from './tickets.service.js';

const SCANNER: UserContext = { subject: 'system:attachment-scanner', roles: ['attachment-scanner'], branch: '', queues: [], department: '', legalEntity: '', country: '', serviceIdentity: true };

/**
 * Scans uploaded attachments with ClamAV. Runs only when CLAMAV_HOST is set and object storage is configured.
 * It acts through the same method and permission (`attachment:scan`) that an external scanner service would use,
 * so the state machine and audit trail are identical. Files are streamed from storage to the scanner, never stored locally.
 * A checksum that differs from the one the uploader declared is never released: it is recorded as a scan error.
 */
@Injectable()
export class AttachmentScanWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentScanWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly db: PgService, private readonly storage: AttachmentStorageService, private readonly tickets: TicketsService) {}

  onModuleInit(): void {
    if (!process.env.CLAMAV_HOST || !process.env.OBJECT_STORAGE_ENDPOINT || !process.env.DATABASE_URL) return;
    this.logger.log(`Attachment scanner started (clamd ${process.env.CLAMAV_HOST}:${process.env.CLAMAV_PORT ?? 3310})`);
    this.schedule(2000);
  }
  onModuleDestroy(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }

  /** One pass; exposed for tests. Returns how many attachments were scanned. */
  async runOnce(): Promise<number> {
    const pending = await this.db.query<{ id: string; ticket_id: string; object_key: string; checksum_sha256: string | null }>("SELECT id,ticket_id,object_key,checksum_sha256 FROM attachments WHERE upload_status='uploaded' AND malware_status='pending_scan' ORDER BY updated_at LIMIT 10");
    let scanned = 0;
    for (const attachment of pending.rows) {
      const correlationId = `scan-${attachment.id}`;
      try {
        const content = await this.storage.getObjectStream(attachment.object_key);
        if (!content) continue;
        const result = await scanWithClamd(process.env.CLAMAV_HOST!, Number(process.env.CLAMAV_PORT ?? 3310), content);
        const checksumMatches = !attachment.checksum_sha256 || attachment.checksum_sha256.toLowerCase() === result.sha256;
        const outcome = !checksumMatches ? 'error' : result.verdict;
        if (!checksumMatches) this.logger.warn(`Checksum mismatch for attachment ${attachment.id}; not releasing`);
        await this.tickets.recordAttachmentScan(SCANNER, attachment.ticket_id, attachment.id, { result: outcome }, correlationId);
        scanned++;
      } catch (error) {
        // Already scanned elsewhere is fine; anything else is retried on the next pass.
        if (!(error instanceof Error && /already completed/.test(error.message))) this.logger.warn(`Scan failed for attachment ${attachment.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return scanned;
  }

  private schedule(delayMs: number): void { if (this.stopped) return; this.timer = setTimeout(() => { void this.tick(); }, delayMs); this.timer.unref(); }
  private async tick(): Promise<void> { try { await this.runOnce(); } catch (error) { this.logger.error(`Scan pass failed: ${error instanceof Error ? error.message : 'unknown error'}`); } this.schedule(5000); }
}
