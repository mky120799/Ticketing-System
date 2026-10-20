import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PgService } from '../database/pg.service.js';
import { CustomerReplyService } from '../intake/customer-reply.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';
import type { CompleteAttachmentDto } from '../tickets/ticket.dto.js';
import type { PortalAttachmentDto } from './portal.dto.js';
import { customerAttachmentStatus } from './customer-attachment-status.js';
import { PortalService } from './portal.service.js';

const maxBytes = () => Number(process.env.PORTAL_MAX_ATTACHMENT_BYTES ?? 10 * 1024 * 1024);
const maxPerRequest = () => Number(process.env.PORTAL_MAX_ATTACHMENTS_PER_REQUEST ?? 10);
const maxPerHour = () => Number(process.env.PORTAL_MAX_UPLOADS_PER_HOUR ?? 20);

/**
 * Who is sending a document and under what authority. A signed-in portal customer proves ownership of the request; a
 * person holding a secure upload link is limited to that link's file count. Everything after that is identical.
 */
export interface UploadAuthority {
  ticketId: string;
  actor: 'customer:portal' | 'customer:link';
  /** Portal customers: their account reference, for the hourly limit. */
  hourlyReference?: string;
  /** Secure link holders: the link and how many files it allows. */
  link?: { id: string; maxFiles: number };
}

/**
 * Lets a customer add documents to their own request, from the portal or through a secure upload link. It follows the
 * staff upload exactly (a signed one-time upload address, bytes straight to object storage, a checksum, malware scan,
 * no download until clean), so a customer file is held to the same rules as any other. It adds what a customer-facing
 * door needs: proof of who may upload, tighter size and count limits, and an ordinary customer reply on the ticket so the
 * SLA clock, status and the people on the case react as they do for any customer message.
 */
@Injectable()
export class PortalAttachmentsService {
  constructor(private readonly db: PgService, private readonly portal: PortalService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly storage: AttachmentStorageService, private readonly replies: CustomerReplyService) {}

  /** Portal customers: the request must be theirs and still open. */
  async authorise(subject: string, ticketId: string): Promise<UploadAuthority> {
    const reference = this.portal.customerReference(subject);
    const ticket = (await this.db.query<{ status: string }>("SELECT t.status FROM tickets t JOIN ticket_references r ON r.ticket_id=t.id WHERE t.id=$1 AND r.opaque_reference=$2 AND t.source_channel='portal' AND t.redacted_at IS NULL", [ticketId, reference])).rows[0];
    if (!ticket) throw new NotFoundException('Request not found');
    if (['closed', 'cancelled'].includes(ticket.status)) throw new ConflictException('This request is closed, so documents can no longer be added. Please raise a new request.');
    return { ticketId, actor: 'customer:portal', hourlyReference: reference };
  }

  createIntent(subject: string, ticketId: string, dto: PortalAttachmentDto, correlationId: string) {
    return this.authorise(subject, ticketId).then((authority) => this.issue(authority, dto, correlationId));
  }

  complete(subject: string, ticketId: string, attachmentId: string, dto: CompleteAttachmentDto, correlationId: string) {
    return this.authorise(subject, ticketId).then((authority) => this.finish(authority, attachmentId, dto, correlationId));
  }

  async issue(authority: UploadAuthority, dto: PortalAttachmentDto, correlationId: string): Promise<{ id: string; uploadUrl: string; uploadMethod: 'PUT'; expiresInSeconds: number }> {
    if (dto.sizeBytes > maxBytes()) throw new HttpException(`Files can be up to ${Math.floor(maxBytes() / 1024 / 1024)} MB.`, HttpStatus.PAYLOAD_TOO_LARGE);
    const filename = dto.filename.replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 255);
    if (!filename) throw new ConflictException('The file name is not valid.');
    const { ticketId, actor } = authority;
    const onRequest = Number((await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM attachments WHERE ticket_id=$1 AND uploaded_by LIKE 'customer:%'", [ticketId])).rows[0].n);
    if (onRequest >= maxPerRequest()) throw new ConflictException(`You can add up to ${maxPerRequest()} documents to one request.`);
    if (authority.link) {
      const used = Number((await this.db.query<{ n: string }>('SELECT count(*)::text AS n FROM attachments WHERE upload_link_id=$1', [authority.link.id])).rows[0].n);
      if (used >= authority.link.maxFiles) throw new ConflictException(`This link allows up to ${authority.link.maxFiles} documents. Please contact us if you need to send more.`);
    }
    if (authority.hourlyReference) {
      const recent = Number((await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM attachments a WHERE a.uploaded_by=$1 AND a.created_at > now() - interval '1 hour' AND EXISTS (SELECT 1 FROM ticket_references r WHERE r.ticket_id=a.ticket_id AND r.opaque_reference=$2)", [actor, authority.hourlyReference])).rows[0].n);
      if (recent >= maxPerHour()) throw new HttpException('You have sent several documents recently. Please wait a while.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const id = randomUUID(); const objectKey = `tickets/${ticketId}/attachments/${id}`;
    const upload = await this.storage.createUploadUrl(objectKey, dto.contentType, dto.sizeBytes);
    if (!upload) throw new ServiceUnavailableException('Sending documents is not available right now. Please bring them to a branch or contact us another way.');
    const source = authority.link ? 'link' : 'portal';
    await this.db.transaction(async (client) => {
      await client.query("INSERT INTO attachments (id,ticket_id,object_key,original_filename,content_type,size_bytes,classification,uploaded_by,upload_link_id) VALUES ($1,$2,$3,$4,$5,$6,'confidential',$7,$8)", [id, ticketId, objectKey, filename, dto.contentType, dto.sizeBytes, actor, authority.link?.id ?? null]);
      await this.audit.write(client, { actorId: actor, action: 'attachment.upload_intent_created', targetType: 'attachment', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, contentType: dto.contentType, sizeBytes: dto.sizeBytes, classification: 'confidential', source } });
      await this.outbox.enqueue(client, { eventType: 'attachment.upload_intent_created', aggregateType: 'attachment', aggregateId: id, correlationId, payload: { attachmentId: id, ticketId, contentType: dto.contentType, sizeBytes: dto.sizeBytes, classification: 'confidential' } });
    });
    return { id, uploadUrl: upload.url, uploadMethod: 'PUT', expiresInSeconds: upload.expiresInSeconds };
  }

  async finish(authority: UploadAuthority, attachmentId: string, dto: CompleteAttachmentDto, correlationId: string): Promise<{ id: string; status: string }> {
    const { ticketId, actor } = authority; const source = authority.link ? 'link' : 'portal';
    await this.db.transaction(async (client) => {
      const attachment = (await client.query<{ upload_status: string; size_bytes: string; original_filename: string }>('SELECT upload_status,size_bytes,original_filename FROM attachments WHERE id=$1 AND ticket_id=$2 AND uploaded_by=$3 AND upload_link_id IS NOT DISTINCT FROM $4 FOR UPDATE', [attachmentId, ticketId, actor, authority.link?.id ?? null])).rows[0];
      if (!attachment) throw new NotFoundException('Document not found');
      if (attachment.upload_status !== 'pending_upload') throw new ConflictException('This document has already been sent.');
      if (Number(attachment.size_bytes) !== dto.sizeBytes) throw new ConflictException('The uploaded file does not match what was declared.');
      await client.query("UPDATE attachments SET upload_status='uploaded', malware_status='pending_scan', checksum_sha256=$1, updated_at=now() WHERE id=$2", [dto.checksumSha256.toLowerCase(), attachmentId]);
      await this.audit.write(client, { actorId: actor, action: 'attachment.upload_completed', targetType: 'attachment', targetId: attachmentId, correlationId, outcome: 'success', metadata: { ticketId, malwareStatus: 'pending_scan', source } });
      await this.outbox.enqueue(client, { eventType: 'attachment.upload_completed', aggregateType: 'attachment', aggregateId: attachmentId, correlationId, payload: { attachmentId, ticketId, malwareStatus: 'pending_scan' } });
      await this.replies.add(client, ticketId, `The customer attached a document: ${attachment.original_filename}`, source);
    });
    return { id: attachmentId, status: customerAttachmentStatus('pending_scan') };
  }
}
