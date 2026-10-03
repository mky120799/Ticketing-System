import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService, type TicketPolicySubject } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { LiveEventsService, type LiveTicket } from '../live/live-events.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { addBusinessDays } from './business-calendar.js';
import type { AfcaDto, ClassifyComplaintDto, CommunicationBlockDto, UpsertRegulatoryProfileDto } from './compliance.dto.js';

export const COMPLIANCE_ACTOR = 'system:regulatory-clock';
const timeZone = () => process.env.BUSINESS_TIMEZONE ?? 'Australia/Sydney';

/** Regulatory status: final-response breach beats missed acknowledgement beats at-risk; resolved tickets are judged on resolved_at. */
const statusSql = (t: string, p: string) => `CASE
  WHEN ${t}.resolved_at IS NOT NULL THEN CASE WHEN ${t}.resolved_at <= ${t}.final_response_due_at THEN 'met' ELSE 'final_response_overdue' END
  WHEN now() > ${t}.final_response_due_at THEN 'final_response_overdue'
  WHEN ${t}.first_responded_at IS NULL AND now() > ${t}.acknowledge_due_at THEN 'ack_overdue'
  WHEN now() > ${t}.final_response_due_at - (${p}.at_risk_days * interval '1 day') THEN 'at_risk'
  ELSE 'on_track' END`;

type TicketScope = TicketPolicySubject & { id: string; status: string; is_complaint: boolean; created_at: Date };
interface ProfileRow { profile_key: string; acknowledge_business_days: number; final_response_calendar_days: number; active: boolean; }

/**
 * Regulatory clocks and case controls that differ by jurisdiction but not by code path: complaint classification,
 * acknowledgement / final-response deadlines (from configurable profiles), vulnerability and systemic-issue flags,
 * external dispute (AFCA) tracking, communication blocks (e.g. tipping-off), and the complaints register.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly live: LiveEventsService) {}

  /** At ticket creation: apply the category's regulatory profile and communication-block default. */
  async applyAtCreation(client: PoolClient, ticket: { id: string; category: string; country: string; createdAt: Date }, correlationId: string, actorId: string): Promise<void> {
    const category = (await client.query<{ regulatory_profile: string | null; block_customer_communication: boolean }>('SELECT regulatory_profile,block_customer_communication FROM ticket_categories WHERE category_key=$1', [ticket.category])).rows[0];
    if (!category) return;
    if (category.block_customer_communication) await client.query('UPDATE tickets SET communications_blocked=true WHERE id=$1', [ticket.id]);
    if (category.regulatory_profile) await this.startClock(client, ticket.id, category.regulatory_profile, ticket.country, ticket.createdAt, correlationId, actorId);
  }

  async classify(user: UserContext, ticketId: string, dto: ClassifyComplaintDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:update');
      if (dto.isComplaint) {
        if (!dto.profileKey) throw new BadRequestException('A regulatory profile is required to mark a complaint');
        // The clock runs from receipt, not from the moment someone noticed it was a complaint.
        await this.startClock(client, ticketId, dto.profileKey, ticket.country, ticket.created_at, correlationId, user.subject);
      } else if (ticket.is_complaint) {
        if (!user.roles.includes('supervisor')) throw new ForbiddenException('Only a supervisor can remove complaint status');
        await client.query("UPDATE tickets SET is_complaint=false, regulatory_profile=NULL, acknowledge_due_at=NULL, final_response_due_at=NULL, regulatory_status=NULL, updated_at=now() WHERE id=$1", [ticketId]);
      }
      if (dto.vulnerabilityFlag !== undefined || dto.systemicIssue !== undefined) {
        await client.query('UPDATE tickets SET vulnerability_flag=COALESCE($1,vulnerability_flag), systemic_issue=COALESCE($2,systemic_issue), updated_at=now() WHERE id=$3', [dto.vulnerabilityFlag ?? null, dto.systemicIssue ?? null, ticketId]);
      }
      const updated = await this.ticket(client, ticketId);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.complaint_classified', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { isComplaint: dto.isComplaint, profileKey: dto.profileKey ?? null, vulnerability: dto.vulnerabilityFlag ?? null, systemic: dto.systemicIssue ?? null, reason: dto.reason } });
      await this.outbox.enqueue(client, { eventType: 'ticket.complaint_classified', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, isComplaint: dto.isComplaint, profileKey: dto.profileKey ?? null } });
      await this.live.notify(client, 'ticket.updated', updated as unknown as LiveTicket);
      return this.view(updated);
    });
  }

  async afca(user: UserContext, ticketId: string, dto: AfcaDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:approve');
      if (!ticket.is_complaint) throw new ConflictException('Only complaints can be referred to the external dispute resolution scheme');
      if (dto.status !== 'closed' && !dto.reference && !(ticket as unknown as { afca_reference: string | null }).afca_reference) throw new BadRequestException('An external reference is required once a case is referred');
      await client.query('UPDATE tickets SET afca_status=$1, afca_reference=COALESCE($2,afca_reference), updated_at=now() WHERE id=$3', [dto.status, dto.reference ?? null, ticketId]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.afca_updated', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { status: dto.status, reference: dto.reference ?? null } });
      await this.outbox.enqueue(client, { eventType: 'ticket.afca_updated', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, status: dto.status } });
      await this.live.notify(client, 'ticket.updated', await this.ticket(client, ticketId) as unknown as LiveTicket);
      return { ticketId, afcaStatus: dto.status, afcaReference: dto.reference ?? null };
    });
  }

  async setCommunicationBlock(user: UserContext, ticketId: string, dto: CommunicationBlockDto, correlationId: string): Promise<unknown> {
    return this.db.transaction(async (client) => {
      const ticket = await this.ticket(client, ticketId); this.policy.assertTicketAccess(user, ticket, 'ticket:approve');
      await client.query('UPDATE tickets SET communications_blocked=$1, updated_at=now() WHERE id=$2', [dto.blocked, ticketId]);
      // The reason is kept in the audit trail only, never in outbox events: it may describe a sensitive investigation.
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.communication_block_changed', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { blocked: dto.blocked, reason: dto.reason } });
      await this.outbox.enqueue(client, { eventType: 'ticket.communication_block_changed', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, blocked: dto.blocked } });
      return { ticketId, communicationsBlocked: dto.blocked };
    });
  }

  /** Scheduler step: recompute regulatory status for open complaints, emitting one event per change. */
  async reconcile(correlationId: string, batchSize = 500): Promise<{ updated: number }> {
    return this.db.transaction(async (client) => {
      const result = await client.query<LiveTicket & { regulatory_status: string }>(`UPDATE tickets t SET regulatory_status=${statusSql('t', 'p')}, updated_at=now()
        FROM regulatory_profiles p
        WHERE p.profile_key=t.regulatory_profile AND t.id IN (
          SELECT t2.id FROM tickets t2 JOIN regulatory_profiles p2 ON p2.profile_key=t2.regulatory_profile
          WHERE t2.is_complaint=true AND t2.status NOT IN ('closed','cancelled') AND t2.regulatory_status IS DISTINCT FROM ${statusSql('t2', 'p2')}
          ORDER BY t2.updated_at LIMIT $1 FOR UPDATE OF t2 SKIP LOCKED)
        RETURNING t.*`, [batchSize]);
      for (const row of result.rows) {
        await this.audit.write(client, { actorId: COMPLIANCE_ACTOR, action: `ticket.regulatory_${row.regulatory_status}`, targetType: 'ticket', targetId: row.id, correlationId, outcome: 'success', metadata: { regulatoryStatus: row.regulatory_status } });
        await this.outbox.enqueue(client, { eventType: 'ticket.regulatory_status_changed', aggregateType: 'ticket', aggregateId: row.id, correlationId, payload: { ticketId: row.id, regulatoryStatus: row.regulatory_status } });
        await this.live.notify(client, 'ticket.sla_changed', row);
      }
      return { updated: result.rows.length };
    });
  }

  /**
   * Subject-access export (Privacy Act APP 12). Supervisor-only and audited. Returns what the platform holds for the
   * reference within the caller's scope. Customer-visible content is included; internal notes are counted but not
   * released, and cases with communications blocked (for example investigations) are withheld, because releasing
   * either needs a human decision under the Act's exceptions.
   */
  async subjectAccess(user: UserContext, reference: string, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'ticket:reveal');
    return this.db.transaction(async (client) => {
      const tickets = (await client.query<Record<string, unknown>>(`SELECT t.id,t.category,t.subject,t.description,t.status,t.source_channel,t.created_at,t.resolved_at,t.idr_outcome,t.is_complaint,t.communications_blocked,t.redacted_at
        FROM tickets t WHERE t.legal_entity=$1 AND t.country=$2 AND t.queue = ANY($3::text[]) AND EXISTS (SELECT 1 FROM ticket_references r WHERE r.ticket_id=t.id AND r.opaque_reference=$4) ORDER BY t.created_at`, [user.legalEntity, user.country, user.queues, reference])).rows;
      const released: unknown[] = []; let withheld = 0;
      for (const t of tickets) {
        if (t.communications_blocked || t.redacted_at) { withheld++; continue; }
        const notes = (await client.query<{ visibility: string; body: string; created_at: Date }>('SELECT visibility,body,created_at FROM ticket_notes WHERE ticket_id=$1 ORDER BY created_at', [t.id])).rows;
        const communications = (await client.query<{ channel: string; template_key: string; status: string; created_at: Date }>('SELECT channel,template_key,status,created_at FROM ticket_communications WHERE ticket_id=$1 ORDER BY created_at', [t.id])).rows;
        released.push({ ticketId: t.id, category: t.category, subject: t.subject, description: t.description, status: t.status, channel: t.source_channel, receivedAt: t.created_at, resolvedAt: t.resolved_at, complaintOutcome: t.idr_outcome, customerNotes: notes.filter((n) => n.visibility === 'customer').map((n) => ({ body: n.body, at: n.created_at })), internalNoteCount: notes.filter((n) => n.visibility !== 'customer').length, communications: communications.map((c) => ({ channel: c.channel, template: c.template_key, status: c.status, at: c.created_at })) });
      }
      await this.audit.write(client, { actorId: user.subject, action: 'privacy.subject_access_exported', targetType: 'customer_reference', targetId: 'redacted', correlationId, outcome: 'success', metadata: { released: released.length, withheld } });
      return { generatedAt: new Date().toISOString(), released, withheldForReview: withheld, note: 'Internal notes and blocked or de-identified cases are not released automatically; a privacy officer must review them.' };
    });
  }

  /** Complaints register for a period. Classifications, dates and outcomes only: no free text or customer data. */
  async register(user: UserContext, from: string, to: string, format: 'json' | 'csv', correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'dashboard:read');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BadRequestException('from and to must be YYYY-MM-DD dates');
    const rows = await this.db.transaction(async (client) => {
      const result = await client.query<Record<string, unknown>>(`SELECT id,category,source_channel,priority,status,regulatory_profile,regulatory_status,created_at AS received_at,acknowledge_due_at,first_responded_at AS acknowledged_at,final_response_due_at,resolved_at AS final_response_at,
          CASE WHEN resolved_at IS NOT NULL THEN round(extract(epoch FROM resolved_at - created_at) / 86400.0, 1) END AS days_to_resolve,idr_outcome,root_cause,vulnerability_flag,systemic_issue,afca_status,afca_reference
        FROM tickets WHERE is_complaint=true AND legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) AND created_at >= $4::date AND created_at < ($5::date + 1) ORDER BY created_at LIMIT 10000`, [user.legalEntity, user.country, user.queues, from, to]);
      await this.audit.write(client, { actorId: user.subject, action: 'report.complaints_register', targetType: 'report', targetId: 'complaints-register', correlationId, outcome: 'success', metadata: { from, to, format, rowCount: result.rows.length } });
      return result.rows;
    });
    if (format === 'json') return { from, to, count: rows.length, complaints: rows };
    return this.toCsv(rows);
  }

  async listProfiles(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ profile_key: string; label: string; jurisdiction: string; acknowledge_business_days: number; final_response_calendar_days: number; at_risk_days: number; active: boolean }>('SELECT profile_key,label,jurisdiction,acknowledge_business_days,final_response_calendar_days,at_risk_days,active FROM regulatory_profiles WHERE jurisdiction=$1 ORDER BY profile_key', [user.country]);
    return result.rows.map((r) => ({ profileKey: r.profile_key, label: r.label, jurisdiction: r.jurisdiction, acknowledgeBusinessDays: r.acknowledge_business_days, finalResponseCalendarDays: r.final_response_calendar_days, atRiskDays: r.at_risk_days, active: r.active }));
  }

  async upsertProfile(user: UserContext, profileKey: string, dto: UpsertRegulatoryProfileDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(profileKey)) throw new ConflictException('Profile key is invalid');
    if (dto.jurisdiction !== user.country) throw new ForbiddenException('Profile jurisdiction must match your country');
    return this.db.transaction(async (client) => {
      const existing = (await client.query<{ jurisdiction: string }>('SELECT jurisdiction FROM regulatory_profiles WHERE profile_key=$1', [profileKey])).rows[0];
      if (existing && existing.jurisdiction !== user.country) throw new ForbiddenException('Profile belongs to another jurisdiction');
      await client.query(`INSERT INTO regulatory_profiles (profile_key,label,jurisdiction,acknowledge_business_days,final_response_calendar_days,at_risk_days,active,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (profile_key) DO UPDATE SET label=EXCLUDED.label, acknowledge_business_days=EXCLUDED.acknowledge_business_days, final_response_calendar_days=EXCLUDED.final_response_calendar_days, at_risk_days=EXCLUDED.at_risk_days, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [profileKey, dto.label, dto.jurisdiction, dto.acknowledgeBusinessDays, dto.finalResponseCalendarDays, dto.atRiskDays, dto.active, user.subject]);
      const data = { profileKey, jurisdiction: dto.jurisdiction, acknowledgeBusinessDays: dto.acknowledgeBusinessDays, finalResponseCalendarDays: dto.finalResponseCalendarDays, atRiskDays: dto.atRiskDays, active: dto.active };
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.regulatory_profile_updated', targetType: 'regulatory_profile', targetId: profileKey, correlationId, outcome: 'success', metadata: data });
      await this.outbox.enqueue(client, { eventType: 'configuration.regulatory_profile_changed', aggregateType: 'regulatory_profile', aggregateId: profileKey, correlationId, payload: data });
      return { ...data, label: dto.label };
    });
  }

  async listHolidays(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ holiday_date: string; name: string }>("SELECT to_char(holiday_date,'YYYY-MM-DD') AS holiday_date,name FROM business_holidays WHERE country=$1 ORDER BY holiday_date", [user.country]);
    return result.rows.map((r) => ({ date: r.holiday_date, name: r.name }));
  }

  async upsertHoliday(user: UserContext, date: string, name: string, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD');
    return this.db.transaction(async (client) => {
      await client.query(`INSERT INTO business_holidays (country,holiday_date,name,updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (country,holiday_date) DO UPDATE SET name=EXCLUDED.name, updated_by=EXCLUDED.updated_by, updated_at=now()`, [user.country, date, name, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.holiday_updated', targetType: 'holiday', targetId: `${user.country}:${date}`, correlationId, outcome: 'success', metadata: { date, name } });
      return { country: user.country, date, name };
    });
  }

  private async startClock(client: PoolClient, ticketId: string, profileKey: string, country: string, receivedAt: Date, correlationId: string, actorId: string): Promise<void> {
    const profile = (await client.query<ProfileRow>('SELECT profile_key,acknowledge_business_days,final_response_calendar_days,active FROM regulatory_profiles WHERE profile_key=$1', [profileKey])).rows[0];
    if (!profile || !profile.active) throw new ConflictException('Regulatory profile does not exist or is inactive');
    const holidays = new Set((await client.query<{ d: string }>("SELECT to_char(holiday_date,'YYYY-MM-DD') AS d FROM business_holidays WHERE country=$1", [country])).rows.map((r) => r.d));
    const acknowledgeDueAt = addBusinessDays(receivedAt, profile.acknowledge_business_days, timeZone(), holidays);
    const finalResponseDueAt = new Date(receivedAt.getTime() + profile.final_response_calendar_days * 86_400_000);
    await client.query("UPDATE tickets SET is_complaint=true, regulatory_profile=$1, acknowledge_due_at=$2, final_response_due_at=$3, regulatory_status='on_track', updated_at=now() WHERE id=$4", [profileKey, acknowledgeDueAt, finalResponseDueAt, ticketId]);
    await this.audit.write(client, { actorId, action: 'ticket.regulatory_clock_started', targetType: 'ticket', targetId: ticketId, correlationId, outcome: 'success', metadata: { profileKey, acknowledgeDueAt: acknowledgeDueAt.toISOString(), finalResponseDueAt: finalResponseDueAt.toISOString() } });
    await this.outbox.enqueue(client, { eventType: 'ticket.regulatory_clock_started', aggregateType: 'ticket', aggregateId: ticketId, correlationId, payload: { ticketId, profileKey, acknowledgeDueAt: acknowledgeDueAt.toISOString(), finalResponseDueAt: finalResponseDueAt.toISOString() } });
  }

  private async ticket(client: PoolClient, id: string): Promise<TicketScope> {
    const row = (await client.query<TicketScope>('SELECT * FROM tickets WHERE id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException('Ticket not found');
    return row;
  }

  private view(source: object): Record<string, unknown> {
    const row = source as Record<string, unknown>;
    return { ticketId: row.id, isComplaint: row.is_complaint, regulatoryProfile: row.regulatory_profile, regulatoryStatus: row.regulatory_status, acknowledgeDueAt: row.acknowledge_due_at, finalResponseDueAt: row.final_response_due_at, vulnerabilityFlag: row.vulnerability_flag, systemicIssue: row.systemic_issue, afcaStatus: row.afca_status };
  }

  private toCsv(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const columns = Object.keys(rows[0]);
    // Cells beginning with = + - @ would be executed as formulas by spreadsheet software; neutralize them.
    const cell = (value: unknown) => { let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
    return [columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n');
  }
}
