import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { PgService } from '../database/pg.service.js';
import { PolicyService, type TicketPolicySubject } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';
import { SlaService } from './sla.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { CaseConfigurationService } from '../configuration/configuration.service.js';
import { WorkflowDefinitionService } from '../workflow/workflow-definition.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { AssignmentService } from './assignment.service.js';
import { LiveEventsService } from '../live/live-events.service.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';
import type { AddNoteDto, ApprovalDecisionDto, ApprovalRequestDto, AssignTicketDto, AttachmentScanResultDto, CompleteAttachmentDto, CreateAttachmentDto, CreateCommunicationDto, CreateTicketDto, LinkTicketDto, SearchTicketsQuery, TransitionTicketDto, UpdateRetentionControlDto, UpdateTicketDto, TicketStatus } from './ticket.dto.js';

type TicketRow = TicketPolicySubject & { id: string; category: string; priority: string; status: string; subject: string; description: string; custom_fields: Record<string, unknown>; created_at: Date; updated_at: Date; sla_policy_key: string | null; first_response_due_at: Date | null; resolution_due_at: Date | null; sla_status: string | null; first_responded_at: Date | null; resolved_at: Date | null; root_cause: string | null; is_complaint: boolean; communications_blocked: boolean; redacted_at: Date | null; };
type ReferenceRow = { id: string; reference_type: string; source_system: string; opaque_reference: string; masked_value: string; classification: string; };
type ApprovalRow = { id: string; ticket_id: string; action_type: string; requested_by: string; status: string; communication_id: string | null; };
type AttachmentRow = { id: string; object_key: string; original_filename: string; content_type: string; size_bytes: string; classification: string; upload_status: string; malware_status: string; checksum_sha256: string | null; uploaded_by: string; created_at: Date; };

@Injectable()
export class TicketsService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly sla: SlaService, private readonly outbox: OutboxService, private readonly configuration: CaseConfigurationService, private readonly storage: AttachmentStorageService, private readonly live: LiveEventsService, private readonly assignment: AssignmentService, private readonly compliance: ComplianceService, private readonly workflows: WorkflowDefinitionService) {}

  async create(user: UserContext, dto: CreateTicketDto, idempotencyKey: string, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'ticket:create');
    if (user.branch !== dto.branchCode || user.department !== dto.department || user.legalEntity !== dto.legalEntity || user.country !== dto.country || !user.queues.includes(dto.queue)) {
      throw new ForbiddenException('Cannot create a ticket outside your authorized scope');
    }
    const requestHash = this.hash(JSON.stringify(dto));
    return this.db.transaction(async (client) => {
      const existing = await client.query<{ request_hash: string; response_ticket_id: string }>('SELECT request_hash, response_ticket_id FROM idempotency_records WHERE actor_id = $1 AND idempotency_key = $2 FOR UPDATE', [user.subject, idempotencyKey]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) throw new ConflictException('Idempotency key was used with a different request');
        return this.getInTransaction(client, existing.rows[0].response_ticket_id, user, correlationId, false);
      }
      const id = randomUUID();
      await this.configuration.assertTicketSelection(client, user, dto.category, dto.queue, dto.department);
      const sla = await this.sla.calculate(client, dto.priority);
      await client.query(`INSERT INTO tickets (id, category, priority, sensitivity, queue, branch_code, department, legal_entity, country, subject, description, custom_fields, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, dto.category, dto.priority, dto.sensitivity, dto.queue, dto.branchCode, dto.department, dto.legalEntity, dto.country, dto.subject, dto.description, JSON.stringify(dto.customFields ?? {}), user.subject]);
      await client.query('UPDATE tickets SET sla_policy_key=$1, first_response_due_at=$2, resolution_due_at=$3, sla_status=$4 WHERE id=$5', [sla.policyKey, sla.firstResponseDueAt, sla.resolutionDueAt, 'running', id]);
      for (const reference of dto.references) {
        await client.query(`INSERT INTO ticket_references (id,ticket_id,reference_type,source_system,opaque_reference,masked_value) VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), id, reference.referenceType, reference.sourceSystem, reference.opaqueReference, this.mask(reference.opaqueReference)]);
      }
      await client.query('INSERT INTO idempotency_records (actor_id,idempotency_key,request_hash,response_ticket_id) VALUES ($1,$2,$3,$4)', [user.subject, idempotencyKey, requestHash, id]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.created', targetType: 'ticket', targetId: id, correlationId, outcome: 'success', metadata: { queue: dto.queue, sensitivity: dto.sensitivity } });
      await this.outbox.enqueue(client, { eventType: 'ticket.created', aggregateType: 'ticket', aggregateId: id, correlationId, payload: { ticketId: id, queue: dto.queue, priority: dto.priority, sensitivity: dto.sensitivity, slaPolicyKey: sla.policyKey, resolutionDueAt: sla.resolutionDueAt.toISOString() } });
      await this.compliance.applyAtCreation(client, { id, category: dto.category, country: dto.country, createdAt: new Date() }, correlationId, user.subject);
      await this.assignment.autoAssign(client, { id, queue: dto.queue, category: dto.category, priority: dto.priority, status: 'submitted' }, correlationId);
      await this.live.notify(client, 'ticket.created', await this.ticket(client, id));
      return this.getInTransaction(client, id, user, correlationId, false);
    });
  }

  /** One audit event per list/search request recording who looked and which tickets were returned (opaque IDs, first 50). */
  private async auditListing(user: UserContext, action: 'ticket.list_viewed' | 'ticket.search_performed', correlationId: string, ids: string[], hadTerm = false): Promise<void> {
    if (process.env.AUDIT_LIST_VIEWS === 'false') return;
    await this.db.transaction((client) => this.audit.write(client, { actorId: user.subject, action, targetType: 'ticket_list', targetId: `${user.legalEntity}:${user.country}`, correlationId, outcome: 'success', metadata: { resultCount: ids.length, ticketIds: ids.slice(0, 50).join(','), ...(action === 'ticket.search_performed' ? { hadSearchTerm: hadTerm } : {}) } }));
  }

  async list(user: UserContext, correlationId: string): Promise<unknown[]> {
    this.policy.assertPermission(user, 'ticket:read');
    const result = await this.db.query<TicketRow>(`SELECT * FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) ORDER BY created_at DESC LIMIT 100`, [user.legalEntity, user.country, user.queues]);
    const visible = result.rows.filter((ticket) => this.canRead(user, ticket));
    await this.auditListing(user, 'ticket.list_viewed', correlationId, visible.map((ticket) => ticket.id));
    return visible.map((ticket) => this.publicTicket(ticket));
  }

  async search(user: UserContext, query: SearchTicketsQuery, correlationId: string): Promise<unknown[]> {
    this.policy.assertPermission(user, 'ticket:read');
    const term = `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    const result = await this.db.query<TicketRow>(`SELECT * FROM tickets
      WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])
        AND (subject ILIKE $4 ESCAPE '\\' OR category ILIKE $4 ESCAPE '\\' OR status ILIKE $4 ESCAPE '\\' OR queue ILIKE $4 ESCAPE '\\')
      ORDER BY created_at DESC LIMIT $5`, [user.legalEntity, user.country, user.queues, term, query.limit]);
    const visible = result.rows.filter((ticket) => this.canRead(user, ticket));
    await this.auditListing(user, 'ticket.search_performed', correlationId, visible.map((ticket) => ticket.id), true);
    return visible.map((ticket) => ({ id: ticket.id, subject: ticket.subject, category: ticket.category, priority: ticket.priority, status: ticket.status, sensitivity: ticket.sensitivity, queue: ticket.queue, branchCode: ticket.branch_code, createdAt: ticket.created_at }));
  }

  async get(user: UserContext, ticketId: string, correlationId: string): Promise<unknown> {
    return this.db.transaction((client) => this.getInTransaction(client, ticketId, user, correlationId, true));
  }

  async updateRetentionControl(user: UserContext, ticketId: string, dto: UpdateRetentionControlDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:hold');
      if (dto.legalHold && !dto.holdReason) throw new ConflictException('A legal-hold reason is required when enabling a hold');
      if (dto.retentionUntil && new Date(dto.retentionUntil).getTime() <= Date.now()) throw new ConflictException('Retention must be in the future');
      const result = await client.query<{ ticket_id: string; retention_until: Date | null; legal_hold: boolean; hold_reason: string | null; updated_at: Date }>(`INSERT INTO ticket_retention_controls (ticket_id,retention_until,legal_hold,hold_reason,updated_by)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (ticket_id) DO UPDATE SET retention_until=EXCLUDED.retention_until, legal_hold=EXCLUDED.legal_hold, hold_reason=EXCLUDED.hold_reason, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING ticket_id,retention_until,legal_hold,hold_reason,updated_at`, [ticketId, dto.retentionUntil ?? null, dto.legalHold, dto.legalHold ? dto.holdReason : null, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.retention_control_updated', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { legalHold: dto.legalHold, retentionUntil: dto.retentionUntil ?? null, hasHoldReason: Boolean(dto.holdReason) } });
      await this.outbox.enqueue(client, { eventType: 'ticket.retention_control_updated', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, legalHold: dto.legalHold, retentionUntil: dto.retentionUntil ?? null } });
      const row = result.rows[0];
      return { ticketId: row.ticket_id, legalHold: row.legal_hold, retentionUntil: row.retention_until, updatedAt: row.updated_at };
    });
  }

  async update(user: UserContext, ticketId: string, dto: UpdateTicketDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      const updated = await client.query<TicketRow>(`UPDATE tickets SET priority=COALESCE($1,priority), description=COALESCE($2,description), custom_fields=COALESCE($3,custom_fields), updated_at=now() WHERE id=$4 RETURNING *`, [dto.priority ?? null, dto.description ?? null, dto.customFields ? JSON.stringify(dto.customFields) : null, ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.updated', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success' });
      await this.outbox.enqueue(client, { eventType: 'ticket.updated', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, priority: dto.priority ?? ticket.priority } });
      await this.live.notify(client, 'ticket.updated', updated.rows[0]);
      return this.publicTicket(updated.rows[0]);
    });
  }

  async assign(user: UserContext, ticketId: string, dto: AssignTicketDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:assign');
      if (!user.queues.includes(dto.queue)) throw new ForbiddenException('Target queue is outside your scope');
      const updated = await client.query<TicketRow>('UPDATE tickets SET queue=$1, assigned_to=$2, status=$3, updated_at=now() WHERE id=$4 RETURNING *', [dto.queue, dto.assigneeId ?? null, 'assigned', ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.assigned', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { queue: dto.queue } });
      await this.outbox.enqueue(client, { eventType: 'ticket.assigned', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, queue: dto.queue, assigneeId: dto.assigneeId ?? null } });
      await this.live.notify(client, 'ticket.assigned', updated.rows[0], ticket.queue);
      return this.publicTicket(updated.rows[0]);
    });
  }

  async revealReferences(user: UserContext, ticketId: string, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:reveal');
      const references = await client.query<ReferenceRow>('SELECT * FROM ticket_references WHERE ticket_id=$1', [ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.reference_revealed', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { count: references.rows.length } });
      await this.outbox.enqueue(client, { eventType: 'ticket.reference_revealed', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, count: references.rows.length } });
      return references.rows.map(({ reference_type, source_system, opaque_reference, classification }) => ({ referenceType: reference_type, sourceSystem: source_system, opaqueReference: opaque_reference, classification }));
    });
  }

  async addNote(user: UserContext, ticketId: string, dto: AddNoteDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      if (ticket.redacted_at) throw new ConflictException('This ticket has been de-identified and can no longer be changed');
      if (dto.visibility === 'customer' && ticket.communications_blocked) throw new ConflictException('Customer-facing activity is blocked on this case');
      const id = randomUUID(); await client.query('INSERT INTO ticket_notes (id,ticket_id,visibility,body,author_id) VALUES ($1,$2,$3,$4,$5)', [id, ticketId, dto.visibility, dto.body, user.subject]);
      if (dto.visibility === 'customer') await client.query('UPDATE tickets SET first_responded_at=COALESCE(first_responded_at, now()) WHERE id=$1', [ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.note_added', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { visibility: dto.visibility } });
      await this.outbox.enqueue(client, { eventType: 'ticket.note_added', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, visibility: dto.visibility } });
      await this.live.notify(client, 'ticket.note_added', ticket);
      return { id, visibility: dto.visibility, createdAt: new Date().toISOString() };
    });
  }

  async transition(user: UserContext, ticketId: string, dto: TransitionTicketDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      if (ticket.redacted_at) throw new ConflictException('This ticket has been de-identified under the retention policy and can no longer be changed');
      await this.workflows.assertTransition(client, ticket.category, ticket.status, dto.toStatus, user.roles);
      await client.query('INSERT INTO ticket_status_history (id,ticket_id,from_status,to_status,reason,changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), ticketId, ticket.status, dto.toStatus, dto.reason, user.subject]);
      if (dto.toStatus === 'resolved' && ticket.is_complaint && !dto.idrOutcome) throw new BadRequestException('A complaint needs a dispute-resolution outcome to be resolved');
      if (dto.toStatus === 'resolved' && !dto.rootCause) throw new BadRequestException('A root cause is required to resolve a ticket');
      // Resolving or waiting on the customer counts as a response; resolved_at/root_cause are set on resolve and cleared on reopen.
      const updated = await client.query<TicketRow>(`UPDATE tickets SET status=$1::text, updated_at=now(),
        first_responded_at = CASE WHEN $1::text IN ('pending_customer','resolved') THEN COALESCE(first_responded_at, now()) ELSE first_responded_at END,
        resolved_at = CASE WHEN $1::text='resolved' THEN now() WHEN $1::text='reopened' THEN NULL ELSE resolved_at END,
        root_cause = CASE WHEN $1::text='resolved' THEN $3 WHEN $1::text='reopened' THEN NULL ELSE root_cause END,
        idr_outcome = CASE WHEN $1::text='resolved' THEN $4 WHEN $1::text='reopened' THEN NULL ELSE idr_outcome END,
        closed_at = CASE WHEN $1::text IN ('closed','cancelled') THEN now() WHEN $1::text='reopened' THEN NULL ELSE closed_at END
        WHERE id=$2 RETURNING *`, [dto.toStatus, ticketId, dto.rootCause ?? null, dto.idrOutcome ?? null]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.status_changed', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { fromStatus: ticket.status, toStatus: dto.toStatus, ...(dto.rootCause ? { rootCause: dto.rootCause } : {}), ...(dto.idrOutcome ? { idrOutcome: dto.idrOutcome } : {}) } });
      await this.outbox.enqueue(client, { eventType: 'ticket.status_changed', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, fromStatus: ticket.status, toStatus: dto.toStatus } });
      await this.live.notify(client, 'ticket.status_changed', updated.rows[0]);
      return this.publicTicket(updated.rows[0]);
    });
  }

  async createAttachment(user: UserContext, ticketId: string, dto: CreateAttachmentDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      if (dto.classification === 'restricted' && !user.roles.includes('supervisor')) throw new ForbiddenException('Restricted attachments require supervisor entitlement');
      const filename = dto.filename.replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 255); if (!filename) throw new ConflictException('Attachment filename is invalid');
      const id = randomUUID(); const objectKey = `tickets/${ticketId}/attachments/${id}`;
      await client.query('INSERT INTO attachments (id,ticket_id,object_key,original_filename,content_type,size_bytes,classification,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, ticketId, objectKey, filename, dto.contentType, dto.sizeBytes, dto.classification, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'attachment.upload_intent_created', targetType: 'attachment', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, contentType: dto.contentType, sizeBytes: dto.sizeBytes, classification: dto.classification } });
      await this.outbox.enqueue(client, { eventType: 'attachment.upload_intent_created', aggregateType: 'attachment', aggregateId: id, correlationId, payload: { attachmentId: id, ticketId, contentType: dto.contentType, sizeBytes: dto.sizeBytes, classification: dto.classification } });
      return { id, objectKey, contentType: dto.contentType, sizeBytes: dto.sizeBytes, filename, uploadMethod: 'PUT', uploadStatus: 'pending_upload', malwareStatus: 'pending_scan' };
    }).then(async (intent) => {
      const upload = await this.storage.createUploadUrl(intent.objectKey, intent.contentType, intent.sizeBytes);
      return { id: intent.id, objectKey: intent.objectKey, uploadMethod: intent.uploadMethod, uploadStatus: intent.uploadStatus, malwareStatus: intent.malwareStatus, uploadUrl: upload?.url ?? null, uploadUrlExpiresInSeconds: upload?.expiresInSeconds ?? null, storageConfigured: Boolean(upload) };
    });
  }

  async completeAttachment(user: UserContext, ticketId: string, attachmentId: string, dto: CompleteAttachmentDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      const attachment = await client.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [attachmentId, ticketId]);
      if (!attachment.rows[0]) throw new NotFoundException('Attachment not found');
      if (Number(attachment.rows[0].size_bytes) !== dto.sizeBytes) throw new ConflictException('Uploaded size does not match the declared size');
      await client.query('UPDATE attachments SET upload_status=$1, malware_status=$2, checksum_sha256=$3, updated_at=now() WHERE id=$4', ['uploaded', 'pending_scan', dto.checksumSha256.toLowerCase(), attachmentId]);
      await this.audit.write(client, { actorId: user.subject, action: 'attachment.upload_completed', targetType: 'attachment', targetId: attachmentId, correlationId, outcome: 'success', metadata: { ticketId, malwareStatus: 'pending_scan' } });
      await this.outbox.enqueue(client, { eventType: 'attachment.upload_completed', aggregateType: 'attachment', aggregateId: attachmentId, correlationId, payload: { attachmentId, ticketId, malwareStatus: 'pending_scan' } });
      return { id: attachmentId, uploadStatus: 'uploaded', malwareStatus: 'pending_scan' };
    });
  }

  async recordAttachmentScan(user: UserContext, ticketId: string, attachmentId: string, dto: AttachmentScanResultDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'attachment:scan');
    return this.db.transaction(async (client) => {
      const attachment = await client.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [attachmentId, ticketId]);
      if (!attachment.rows[0]) throw new NotFoundException('Attachment not found');
      if (attachment.rows[0].upload_status !== 'uploaded') throw new ConflictException('Attachment must be uploaded before scanning');
      if (attachment.rows[0].malware_status !== 'pending_scan') throw new ConflictException('Attachment scan has already completed');
      const malwareStatus = dto.result === 'clean' ? 'clean' : dto.result === 'malicious' ? 'malicious' : 'scan_error';
      await client.query('UPDATE attachments SET malware_status=$1,updated_at=now() WHERE id=$2', [malwareStatus, attachmentId]);
      await this.audit.write(client, { actorId: user.subject, action: 'attachment.scan_completed', targetType: 'attachment', targetId: attachmentId, correlationId, outcome: 'success', metadata: { ticketId, malwareStatus } });
      await this.outbox.enqueue(client, { eventType: 'attachment.scan_completed', aggregateType: 'attachment', aggregateId: attachmentId, correlationId, payload: { attachmentId, ticketId, malwareStatus } });
      return { id: attachmentId, malwareStatus };
    });
  }

  async downloadAttachment(user: UserContext, ticketId: string, attachmentId: string, correlationId: string): Promise<unknown> {
    const metadata = await this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:read');
      const attachment = await client.query<AttachmentRow>('SELECT * FROM attachments WHERE id=$1 AND ticket_id=$2', [attachmentId, ticketId]);
      if (!attachment.rows[0]) throw new NotFoundException('Attachment not found');
      if (attachment.rows[0].upload_status !== 'uploaded' || attachment.rows[0].malware_status !== 'clean') throw new ConflictException('Attachment is not available until upload and malware scanning complete');
      const row = attachment.rows[0];
      await this.audit.write(client, { actorId: user.subject, action: 'attachment.download_requested', targetType: 'attachment', targetId: attachmentId, correlationId, outcome: 'success', metadata: { ticketId, classification: row.classification } });
      await this.outbox.enqueue(client, { eventType: 'attachment.download_requested', aggregateType: 'attachment', aggregateId: attachmentId, correlationId, payload: { attachmentId, ticketId } });
      return { objectKey: row.object_key, contentType: row.content_type, filename: row.original_filename };
    });
    const download = await this.storage.createDownloadUrl(metadata.objectKey, metadata.contentType, metadata.filename);
    return { attachmentId, filename: metadata.filename, contentType: metadata.contentType, downloadUrl: download?.url ?? null, downloadUrlExpiresInSeconds: download?.expiresInSeconds ?? null, storageConfigured: Boolean(download) };
  }

  async linkTicket(user: UserContext, ticketId: string, dto: LinkTicketDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const source = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, source, 'ticket:update');
      const target = await this.ticket(client, dto.targetTicketId); this.policy.assertTicketAccess(user, target, 'ticket:read');
      if (source.legal_entity !== target.legal_entity || source.country !== target.country) throw new ForbiddenException('Cross-entity ticket relationships are not permitted');
      try { await client.query('INSERT INTO ticket_relationships (source_ticket_id,target_ticket_id,relationship_type,created_by) VALUES ($1,$2,$3,$4)', [ticketId, dto.targetTicketId, dto.relationshipType, user.subject]); }
      catch (error) { if (error instanceof Error && error.message.includes('ticket_relationship_pk')) throw new ConflictException('Relationship already exists'); throw error; }
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.relationship_created', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { targetTicketId: dto.targetTicketId, relationshipType: dto.relationshipType } });
      await this.outbox.enqueue(client, { eventType: 'ticket.relationship_created', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, targetTicketId: dto.targetTicketId, relationshipType: dto.relationshipType } });
      return { sourceTicketId: ticketId, targetTicketId: dto.targetTicketId, relationshipType: dto.relationshipType };
    });
  }

  async createCommunication(user: UserContext, ticketId: string, dto: CreateCommunicationDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      if (ticket.redacted_at) throw new ConflictException('This ticket has been de-identified and can no longer be changed');
      if (ticket.communications_blocked) throw new ConflictException('Customer communications are blocked on this case');
      const template = await client.query<{ template_key: string; channel: string; requires_approval: boolean }>('SELECT template_key,channel,requires_approval FROM communication_templates WHERE template_key=$1 AND channel=$2 AND active=true', [dto.templateKey, dto.channel]);
      if (!template.rows[0]) throw new ConflictException('Communication template is not active for this channel');
      const id = randomUUID();
      const status = template.rows[0].requires_approval ? 'pending_approval' : 'queued';
      const eventType = status === 'queued' ? 'customer_communication.queued' : 'customer_communication.pending_approval';
      const auditAction = status === 'queued' ? 'customer_communication.queued' : 'customer_communication.approval_requested';
      await client.query('INSERT INTO ticket_communications (id,ticket_id,channel,template_key,recipient_reference,recipient_masked,created_by,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, ticketId, dto.channel, dto.templateKey, dto.recipientReference, this.mask(dto.recipientReference), user.subject, status]);
      if (status === 'queued') await client.query('UPDATE tickets SET first_responded_at=COALESCE(first_responded_at, now()) WHERE id=$1', [ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: auditAction, targetType: 'communication', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, channel: dto.channel, templateKey: dto.templateKey, status } });
      let approvalId: string | undefined;
      if (status === 'pending_approval') {
        approvalId = randomUUID();
        const actionType = `customer_communication:${dto.templateKey}`;
        await client.query('INSERT INTO approval_requests (id,ticket_id,communication_id,action_type,requested_by) VALUES ($1,$2,$3,$4,$5)', [approvalId, ticketId, id, actionType, user.subject]);
        await this.audit.write(client, { actorId: user.subject, action: 'approval.requested', targetType: 'approval', targetId: approvalId, correlationId, outcome: 'success', metadata: { ticketId, communicationId: id, actionType } });
        await this.outbox.enqueue(client, { eventType: 'approval.requested', aggregateType: 'approval', aggregateId: approvalId, correlationId, payload: { approvalId, ticketId, communicationId: id, actionType } });
      }
      await this.outbox.enqueue(client, { eventType, aggregateType: 'communication', aggregateId: id, correlationId, payload: { communicationId: id, ticketId, channel: dto.channel, templateKey: dto.templateKey, status } });
      return { id, channel: dto.channel, templateKey: dto.templateKey, recipientMasked: this.mask(dto.recipientReference), status, ...(approvalId ? { approvalId } : {}) };
    });
  }

  async requestApproval(user: UserContext, ticketId: string, dto: ApprovalRequestDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      const id = randomUUID(); await client.query('INSERT INTO approval_requests (id,ticket_id,action_type,requested_by) VALUES ($1,$2,$3,$4)', [id, ticketId, dto.actionType, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'approval.requested', targetType: 'approval', targetId: id, correlationId, outcome: 'success', metadata: { ticketId, actionType: dto.actionType } });
      await this.outbox.enqueue(client, { eventType: 'approval.requested', aggregateType: 'approval', aggregateId: id, correlationId, payload: { approvalId: id, ticketId, actionType: dto.actionType } });
      return { id, status: 'pending' };
    });
  }

  async decideApproval(user: UserContext, ticketId: string, approvalId: string, dto: ApprovalDecisionDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const approval = await client.query<ApprovalRow>('SELECT * FROM approval_requests WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [approvalId, ticketId]);
      if (!approval.rows[0]) throw new NotFoundException('Approval request not found');
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:approve');
      this.policy.assertMakerChecker(approval.rows[0].requested_by, user.subject);
      if (approval.rows[0].status !== 'pending') throw new ConflictException('Approval has already been decided');
      await client.query('UPDATE approval_requests SET status=$1 WHERE id=$2', [dto.decision, approvalId]);
      await this.audit.write(client, { actorId: user.subject, action: `approval.${dto.decision}`, targetType: 'approval', targetId: approvalId, correlationId, outcome: 'success', metadata: { ticketId } });
      await this.outbox.enqueue(client, { eventType: `approval.${dto.decision}`, aggregateType: 'approval', aggregateId: approvalId, correlationId, payload: { approvalId, ticketId, decision: dto.decision } });
      if (approval.rows[0].communication_id) {
        const communication = await client.query<{ id: string; channel: string; template_key: string; status: string }>('SELECT id,channel,template_key,status FROM ticket_communications WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [approval.rows[0].communication_id, ticketId]);
        if (!communication.rows[0] || communication.rows[0].status !== 'pending_approval') throw new ConflictException('Communication is no longer awaiting approval');
        const communicationStatus = dto.decision === 'approved' ? 'queued' : 'rejected';
        await client.query('UPDATE ticket_communications SET status=$1,updated_at=now() WHERE id=$2', [communicationStatus, approval.rows[0].communication_id]);
        if (communicationStatus === 'queued') await client.query('UPDATE tickets SET first_responded_at=COALESCE(first_responded_at, now()) WHERE id=$1', [ticketId]);
        await this.audit.write(client, { actorId: user.subject, action: `customer_communication.${communicationStatus}`, targetType: 'communication', targetId: communication.rows[0].id, correlationId, outcome: 'success', metadata: { ticketId, approvalId } });
        await this.outbox.enqueue(client, { eventType: `customer_communication.${communicationStatus}`, aggregateType: 'communication', aggregateId: communication.rows[0].id, correlationId, payload: { communicationId: communication.rows[0].id, ticketId, channel: communication.rows[0].channel, templateKey: communication.rows[0].template_key, status: communicationStatus } });
      }
      return { id: approvalId, status: dto.decision };
    });
  }

  private async getInTransaction(client: PoolClient, ticketId: string, user: UserContext, correlationId: string, auditView: boolean): Promise<unknown> {
    const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:read');
    const references = await client.query<ReferenceRow>('SELECT * FROM ticket_references WHERE ticket_id=$1', [ticketId]);
    const notes = await client.query<{ id: string; visibility: string; body: string; author_id: string; created_at: Date }>('SELECT id,visibility,body,author_id,created_at FROM ticket_notes WHERE ticket_id=$1 ORDER BY created_at ASC', [ticketId]);
    const attachments = await client.query<AttachmentRow>('SELECT id,object_key,original_filename,content_type,size_bytes,classification,upload_status,malware_status,checksum_sha256,uploaded_by,created_at FROM attachments WHERE ticket_id=$1 ORDER BY created_at ASC', [ticketId]);
    const relationships = await client.query<{ source_ticket_id: string; target_ticket_id: string; relationship_type: string }>('SELECT source_ticket_id,target_ticket_id,relationship_type FROM ticket_relationships WHERE source_ticket_id=$1 OR target_ticket_id=$1', [ticketId]);
    const communications = await client.query<{ id: string; channel: string; template_key: string; recipient_masked: string; status: string; created_at: Date; approval_id: string | null }>('SELECT c.id,c.channel,c.template_key,c.recipient_masked,c.status,c.created_at,a.id AS approval_id FROM ticket_communications c LEFT JOIN approval_requests a ON a.communication_id=c.id WHERE c.ticket_id=$1 ORDER BY c.created_at ASC', [ticketId]);
    const history = await client.query<{ from_status: string | null; to_status: string; reason: string; changed_by: string; changed_at: Date }>('SELECT from_status,to_status,reason,changed_by,changed_at FROM ticket_status_history WHERE ticket_id=$1 ORDER BY changed_at ASC', [ticketId]);
    const retention = await client.query<{ retention_until: Date | null; legal_hold: boolean; updated_at: Date }>('SELECT retention_until,legal_hold,updated_at FROM ticket_retention_controls WHERE ticket_id=$1', [ticketId]);
    if (auditView) await this.audit.write(client, { actorId: user.subject, action: 'ticket.viewed', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success' });
    const allowedNextStatuses = await this.workflows.nextStatuses(ticket.category, ticket.status, user.roles);
    return { ...this.publicTicket(ticket), allowedNextStatuses, references: references.rows.map(({ reference_type, source_system, masked_value, classification }) => ({ referenceType: reference_type, sourceSystem: source_system, maskedValue: masked_value, classification })), notes: notes.rows.map(({ id, visibility, body, author_id, created_at }) => ({ id, visibility, body, authorId: author_id, createdAt: created_at })), attachments: attachments.rows.map(({ id, original_filename, content_type, size_bytes, classification, upload_status, malware_status, checksum_sha256, uploaded_by, created_at }) => ({ id, filename: original_filename, contentType: content_type, sizeBytes: Number(size_bytes), classification, uploadStatus: upload_status, malwareStatus: malware_status, checksumSha256: checksum_sha256, uploadedBy: uploaded_by, createdAt: created_at })), relatedTickets: relationships.rows.map(({ source_ticket_id, target_ticket_id, relationship_type }) => ({ ticketId: source_ticket_id === ticketId ? target_ticket_id : source_ticket_id, relationshipType: relationship_type, direction: source_ticket_id === ticketId ? 'outgoing' : 'incoming' })), communications: communications.rows.map(({ id, channel, template_key, recipient_masked, status, created_at, approval_id }) => ({ id, channel, templateKey: template_key, recipientMasked: recipient_masked, status, ...(approval_id ? { approvalId: approval_id } : {}), createdAt: created_at })), history: history.rows.map(({ from_status, to_status, reason, changed_by, changed_at }) => ({ fromStatus: from_status, toStatus: to_status, reason, changedBy: changed_by, changedAt: changed_at })), retention: retention.rows[0] ? { legalHold: retention.rows[0].legal_hold, retentionUntil: retention.rows[0].retention_until, updatedAt: retention.rows[0].updated_at } : null };
  }
  private async ticket(client: PoolClient, ticketId: string): Promise<TicketRow> { const result = await client.query<TicketRow>('SELECT * FROM tickets WHERE id=$1', [ticketId]); if (!result.rows[0]) throw new NotFoundException('Ticket not found'); return result.rows[0]; }
  private publicTicket(ticket: TicketRow): Record<string, unknown> { const { branch_code, legal_entity, custom_fields, created_at, updated_at, sla_policy_key, first_response_due_at, resolution_due_at, sla_status, ...rest } = ticket; return { ...rest, branchCode: branch_code, legalEntity: legal_entity, customFields: custom_fields, createdAt: created_at, updatedAt: updated_at, slaPolicyKey: sla_policy_key, firstResponseDueAt: first_response_due_at, resolutionDueAt: resolution_due_at, slaStatus: sla_status }; }
  private canRead(user: UserContext, ticket: TicketRow): boolean { try { this.policy.assertTicketAccess(user, ticket, 'ticket:read'); return true; } catch { return false; } }
  private mask(value: string): string { return value.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`; }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}
