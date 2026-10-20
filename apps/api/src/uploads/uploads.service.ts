import { Injectable, NotFoundException } from '@nestjs/common';
import { PgService } from '../database/pg.service.js';
import { ticketReference } from '../email/message-template.js';
import { customerAttachmentStatus } from '../portal/customer-attachment-status.js';
import { PortalAttachmentsService, type UploadAuthority } from '../portal/portal-attachments.service.js';
import type { PortalAttachmentDto } from '../portal/portal.dto.js';
import type { CompleteAttachmentDto } from '../tickets/ticket.dto.js';
import { verifyUploadLinkToken } from '../tickets/upload-link-token.js';

interface LinkRow { id: string; ticket_id: string; max_files: number; expires_at: Date; }

/**
 * The customer's side of a secure upload link. Holding a genuine, current link is the only proof required, and it
 * opens exactly one thing: sending documents to one request. It cannot read the request, its notes or anyone else's
 * documents. Every reason a link fails (forged, expired, withdrawn, not yet approved, request closed) gives the same
 * answer, so nobody can use it to learn what exists.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly db: PgService, private readonly attachments: PortalAttachmentsService) {}

  private async resolve(token: string | undefined): Promise<{ authority: UploadAuthority; link: LinkRow }> {
    const id = verifyUploadLinkToken(token);
    const link = id ? (await this.db.query<LinkRow>(
      `SELECT l.id,l.ticket_id,l.max_files,l.expires_at FROM upload_links l
         JOIN ticket_communications c ON c.id=l.communication_id JOIN tickets t ON t.id=l.ticket_id
        WHERE l.id=$1 AND l.revoked_at IS NULL AND l.expires_at > now() AND c.status IN ('queued','sent','delivered')
          AND t.redacted_at IS NULL AND t.status NOT IN ('closed','cancelled')`, [id])).rows[0] : undefined;
    if (!link) throw new NotFoundException('This link is not valid or has expired. Please contact the bank.');
    return { link, authority: { ticketId: link.ticket_id, actor: 'customer:link', link: { id: link.id, maxFiles: link.max_files } } };
  }

  async status(token: string | undefined): Promise<unknown> {
    const { link } = await this.resolve(token);
    const files = await this.db.query<{ id: string; original_filename: string; malware_status: string }>("SELECT id,original_filename,malware_status FROM attachments WHERE upload_link_id=$1 AND upload_status='uploaded' ORDER BY created_at", [link.id]);
    return { reference: ticketReference(link.ticket_id), expiresAt: link.expires_at, remaining: Math.max(0, link.max_files - Number((await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM attachments WHERE upload_link_id=$1', [link.id])).rows[0].n)), documents: files.rows.map((f) => ({ id: f.id, filename: f.original_filename, status: customerAttachmentStatus(f.malware_status) })) };
  }

  async createIntent(token: string | undefined, dto: PortalAttachmentDto, correlationId: string) {
    const { authority } = await this.resolve(token);
    return this.attachments.issue(authority, dto, correlationId);
  }

  async complete(token: string | undefined, attachmentId: string, dto: CompleteAttachmentDto, correlationId: string) {
    const { authority } = await this.resolve(token);
    return this.attachments.finish(authority, attachmentId, dto, correlationId);
  }
}
