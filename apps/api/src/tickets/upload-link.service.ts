import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { uploadLinksConfigured } from './upload-link-token.js';

const ttlHours = () => Number(process.env.UPLOAD_LINK_TTL_HOURS ?? 72);
const maxFiles = () => Number(process.env.UPLOAD_LINK_MAX_FILES ?? 5);

/**
 * Creates and withdraws the secure upload links that go out in "document request" messages. A link belongs to the
 * message that carries it: it is created in the same transaction, only works once that message is approved and queued,
 * and stops working when it expires, is withdrawn, or the request is closed.
 */
@Injectable()
export class UploadLinkService {
  constructor(private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  assertConfigured(): void {
    if (!uploadLinksConfigured()) throw new ServiceUnavailableException('Secure upload links are not set up on this system');
  }

  async issue(client: PoolClient, ticketId: string, communicationId: string, createdBy: string, correlationId: string): Promise<string> {
    const id = randomUUID();
    await client.query("INSERT INTO upload_links (id,ticket_id,communication_id,created_by,expires_at,max_files) VALUES ($1,$2,$3,$4, now() + ($5 * interval '1 hour'), $6)", [id, ticketId, communicationId, createdBy, ttlHours(), maxFiles()]);
    await this.audit.write(client, { actorId: createdBy, action: 'upload_link.created', targetType: 'upload_link', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, communicationId, expiresInHours: ttlHours(), maxFiles: maxFiles() } });
    await this.outbox.enqueue(client, { eventType: 'upload_link.created', aggregateType: 'upload_link', aggregateId: id, correlationId, payload: { linkId: id, ticketId, communicationId } });
    return id;
  }

  async revoke(client: PoolClient, ticketId: string, linkId: string, actor: string, correlationId: string): Promise<void> {
    const link = (await client.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM upload_links WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [linkId, ticketId])).rows[0];
    if (!link) throw new NotFoundException('Upload link not found');
    if (link.revoked_at) throw new ConflictException('This link has already been withdrawn');
    await client.query('UPDATE upload_links SET revoked_at=now(), revoked_by=$1 WHERE id=$2', [actor, linkId]);
    await this.audit.write(client, { actorId: actor, action: 'upload_link.revoked', targetType: 'upload_link', targetId: linkId, correlationId, outcome: 'success', metadata: { ticketId } });
    await this.outbox.enqueue(client, { eventType: 'upload_link.revoked', aggregateType: 'upload_link', aggregateId: linkId, correlationId, payload: { linkId, ticketId } });
  }
}
