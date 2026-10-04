import { HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { friendlyStatus, renderMessage, ticketReference } from '../email/message-template.js';
import { CustomerReplyService } from '../intake/customer-reply.service.js';
import { IntakeService } from '../intake/intake.service.js';
import type { CreatePortalRequestDto } from './portal.dto.js';

const ADAPTER: UserContext = { subject: 'system:portal', roles: ['intake-gateway'], branch: '', queues: [], department: '', legalEntity: '', country: '', serviceIdentity: true };
const MAX_REQUESTS_PER_HOUR = () => Number(process.env.PORTAL_MAX_REQUESTS_PER_HOUR ?? 10);
const MAX_MESSAGES_PER_HOUR = () => Number(process.env.PORTAL_MAX_MESSAGES_PER_HOUR ?? 30);

/** The customer-facing view of their own requests. Everything is keyed by the customer's identity and never shows internal data. */
@Injectable()
export class PortalService {
  constructor(private readonly db: PgService, private readonly intake: IntakeService, private readonly replies: CustomerReplyService) {}

  /** The opaque reference stored on the customer's tickets. Derived from their account ID; long IDs are hashed to fit. */
  customerReference(subject: string): string { return subject.length <= 200 ? `PORTAL-${subject}` : `PORTAL-${createHash('sha256').update(subject).digest('hex').slice(0, 40)}`; }

  async create(subject: string, dto: CreatePortalRequestDto, idempotencyKey: string, correlationId: string): Promise<{ id: string; reference: string; duplicate: boolean }> {
    const reference = this.customerReference(subject);
    const recent = Number((await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM tickets t JOIN ticket_references r ON r.ticket_id=t.id WHERE t.source_channel='portal' AND r.opaque_reference=$1 AND t.created_at > now() - interval '1 hour'", [reference])).rows[0].n);
    if (recent >= MAX_REQUESTS_PER_HOUR()) throw new HttpException('You have raised several requests recently. Please wait a while before raising another.', HttpStatus.TOO_MANY_REQUESTS);
    try {
      const created = await this.intake.create(ADAPTER, 'portal', { messageId: `${reference}:${idempotencyKey}`.slice(0, 200), senderReference: reference, subject: dto.subject.trim(), body: dto.description.trim(), ...(dto.kind === 'complaint' ? { category: 'complaint' } : dto.kind === 'correction' ? { category: 'privacy-correction' } : {}) }, correlationId);
      return { id: created.ticketId, reference: ticketReference(created.ticketId), duplicate: created.duplicate };
    } catch (error) {
      if (error instanceof NotFoundException) throw new ServiceUnavailableException('This service is not available right now. Please contact the bank another way.');
      throw error;
    }
  }

  async list(subject: string): Promise<unknown[]> {
    const rows = await this.db.query<{ id: string; subject: string; status: string; created_at: Date; updated_at: Date; is_complaint: boolean; case_kind: string | null; regulatory_profile: string | null; first_responded_at: Date | null; final_response_due_at: Date | null }>(
      `SELECT t.id,t.subject,t.status,t.created_at,t.updated_at,t.is_complaint,t.case_kind,t.regulatory_profile,t.first_responded_at,t.final_response_due_at FROM tickets t JOIN ticket_references r ON r.ticket_id=t.id
       WHERE r.opaque_reference=$1 AND t.source_channel='portal' AND t.redacted_at IS NULL ORDER BY t.created_at DESC LIMIT 100`, [this.customerReference(subject)]);
    return rows.rows.map((r) => this.summary(r));
  }

  async detail(subject: string, ticketId: string): Promise<unknown> {
    const t = (await this.db.query<{ id: string; subject: string; description: string; status: string; created_at: Date; updated_at: Date; is_complaint: boolean; case_kind: string | null; regulatory_profile: string | null; first_responded_at: Date | null; final_response_due_at: Date | null }>(
      `SELECT t.id,t.subject,t.description,t.status,t.created_at,t.updated_at,t.is_complaint,t.case_kind,t.regulatory_profile,t.first_responded_at,t.final_response_due_at FROM tickets t JOIN ticket_references r ON r.ticket_id=t.id
       WHERE t.id=$1 AND r.opaque_reference=$2 AND t.source_channel='portal' AND t.redacted_at IS NULL`, [ticketId, this.customerReference(subject)])).rows[0];
    if (!t) throw new NotFoundException('Request not found');
    const notes = await this.db.query<{ body: string; author_id: string; created_at: Date }>("SELECT body,author_id,created_at FROM ticket_notes WHERE ticket_id=$1 AND visibility='customer' ORDER BY created_at", [ticketId]);
    const messages = await this.db.query<{ subject_template: string; body_template: string; created_at: Date }>("SELECT tpl.subject_template,tpl.body_template,c.created_at FROM ticket_communications c JOIN communication_templates tpl ON tpl.template_key=c.template_key WHERE c.ticket_id=$1 AND c.channel='portal' AND c.status IN ('sent','delivered') ORDER BY c.created_at", [ticketId]);
    const updates = [
      ...notes.rows.map((n) => ({ from: n.author_id.startsWith('customer:') ? 'you' : 'bank', text: n.body, at: n.created_at })),
      ...messages.rows.map((m) => { const rendered = renderMessage(m.subject_template, m.body_template, ticketId, t.status); return { from: 'bank', title: rendered.subject, text: rendered.text, at: m.created_at }; })
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { ...this.summary(t), description: t.description, updates };
  }

  async reply(subject: string, ticketId: string, body: string): Promise<void> {
    await this.detail(subject, ticketId); // ownership check (404 for anyone else's request)
    const recent = Number((await this.db.query<{ n: string }>("SELECT count(*)::text AS n FROM ticket_notes n JOIN ticket_references r ON r.ticket_id=n.ticket_id WHERE n.author_id='customer:portal' AND r.opaque_reference=$1 AND n.created_at > now() - interval '1 hour'", [this.customerReference(subject)])).rows[0].n);
    if (recent >= MAX_MESSAGES_PER_HOUR()) throw new HttpException('You have sent several messages recently. Please wait a while.', HttpStatus.TOO_MANY_REQUESTS);
    await this.db.transaction((client) => this.replies.add(client, ticketId, body.trim(), 'portal'));
  }

  private summary(r: { id: string; subject: string; status: string; created_at: Date; updated_at: Date; is_complaint: boolean; case_kind: string | null; regulatory_profile: string | null; first_responded_at: Date | null; final_response_due_at: Date | null }) {
    // Complaints and privacy-correction requests both run on a regulated clock the customer is entitled to see.
    return { id: r.id, reference: ticketReference(r.id), subject: r.subject, status: friendlyStatus(r.status), createdAt: r.created_at, updatedAt: r.updated_at, isComplaint: r.is_complaint, kind: r.case_kind === 'privacy_request' ? 'correction' : r.is_complaint ? 'complaint' : 'request', ...(r.regulatory_profile ? { complaint: { acknowledged: r.first_responded_at !== null, finalResponseDueBy: r.final_response_due_at } } : {}) };
  }
}
