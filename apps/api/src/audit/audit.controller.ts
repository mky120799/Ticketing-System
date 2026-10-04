import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PolicyService, type TicketPolicySubject } from '../auth/policy.service.js';
import { AuditService } from './audit.service.js';
import { AuditIntegrityService } from './audit-integrity.service.js';
import { AuditSearchQuery } from './audit-search.dto.js';
import { PgService } from '../database/pg.service.js';

@Controller('audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly integrity: AuditIntegrityService) {}

  /** Integrity status of the whole trail and the latest published anchor. */
  @Get('chain-status')
  chainStatus(@Req() request: FastifyRequest) { this.policy.assertPermission(request.user!, 'audit:read'); return this.integrity.latest(); }

  /** Runs a verification now (incremental, or `?full=true` to re-walk the whole trail). The run itself is audited. */
  @Post('verify')
  async verify(@Req() request: FastifyRequest, @Query('full') full?: string) {
    const user = request.user!; this.policy.assertPermission(user, 'audit:read');
    const result = await this.integrity.verify(full === 'true');
    await this.db.transaction((client) => this.audit.write(client, { actorId: user.subject, action: 'audit.verification_run', targetType: 'audit_chain', targetId: 'chain', correlationId: request.correlationId!, outcome: 'success', metadata: { status: result.status, eventsChecked: result.eventsChecked, full: full === 'true' } }));
    return result;
  }

  @Get('anchors')
  anchors(@Req() request: FastifyRequest) { this.policy.assertPermission(request.user!, 'audit:read'); return this.integrity.listAnchors(); }

  /**
   * Cross-ticket search for auditors. Limited to events about tickets in the auditor's entity, country and queues,
   * excluding restricted-sensitivity tickets (those need supervisor entitlement), mirroring ticket access rules.
   */
  @Get('events')
  async search(@Req() request: FastifyRequest, @Query() query: AuditSearchQuery) {
    const user = request.user!; this.policy.assertPermission(user, 'audit:read');
    const limit = query.limit ?? 50;
    const rows = await this.db.query<{ sequence: string; id: string; occurred_at: Date; actor_id: string; action: string; target_type: string; target_id: string; correlation_id: string; outcome: string; metadata: Record<string, unknown>; event_hash: string }>(
      `SELECT e.sequence,e.id,e.occurred_at,e.actor_id,e.action,e.target_type,e.target_id,e.correlation_id,e.outcome,e.metadata,e.event_hash
       FROM audit_events e LEFT JOIN tickets t ON t.id::text = CASE WHEN e.target_type='ticket' THEN e.target_id ELSE e.metadata->>'ticketId' END
       WHERE ((t.id IS NOT NULL AND t.legal_entity=$1 AND t.country=$2 AND t.queue = ANY($3::text[]) AND (t.sensitivity <> 'restricted' OR $4::boolean))
              OR (e.target_type='ticket_list' AND e.target_id = $12))
         AND ($5::text IS NULL OR e.actor_id = $5) AND ($6::text IS NULL OR e.action LIKE $6 ESCAPE '\\') AND ($7::text IS NULL OR e.outcome = $7)
         AND ($8::timestamptz IS NULL OR e.occurred_at >= $8) AND ($9::timestamptz IS NULL OR e.occurred_at < $9) AND ($10::bigint IS NULL OR e.sequence < $10)
       ORDER BY e.sequence DESC LIMIT $11`,
      [user.legalEntity, user.country, user.queues, user.roles.includes('supervisor'), query.actor ?? null, query.action ? `${query.action.replace(/[\\%_]/g, '\\$&')}%` : null, query.outcome ?? null, query.from ?? null, query.to ?? null, query.before ?? null, limit, `${user.legalEntity}:${user.country}`]);
    await this.db.transaction((client) => this.audit.write(client, { actorId: user.subject, action: 'audit.searched', targetType: 'audit_chain', targetId: 'search', correlationId: request.correlationId!, outcome: 'success', metadata: { resultCount: rows.rows.length, filteredByActor: Boolean(query.actor), filteredByAction: Boolean(query.action) } }));
    const events = rows.rows.map((r) => ({ sequence: Number(r.sequence), id: r.id, occurredAt: r.occurred_at, actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, correlationId: r.correlation_id, outcome: r.outcome, metadata: r.metadata, eventHash: r.event_hash }));
    return { events, nextBefore: events.length === limit ? events[events.length - 1].sequence : null };
  }

  @Get('tickets/:ticketId')
  async ticketReport(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Query('limit') limitValue?: string) {
    return this.report(request, ticketId, limitValue, 'audit.report_viewed');
  }

  @Get('tickets/:ticketId/export')
  async ticketExport(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Query('limit') limitValue?: string) {
    return this.report(request, ticketId, limitValue, 'audit.exported');
  }

  private async report(request: FastifyRequest, ticketId: string, limitValue: string | undefined, auditAction: 'audit.report_viewed' | 'audit.exported') {
    const user = request.user!; this.policy.assertPermission(user, 'audit:read'); if (auditAction === 'audit.exported') this.policy.assertStepUp(user, 'export an audit report');
    const ticket = await this.db.query<TicketPolicySubject>('SELECT queue,branch_code,department,legal_entity,country,sensitivity,created_by,assigned_to FROM tickets WHERE id=$1', [ticketId]);
    if (!ticket.rows[0]) return { events: [] };
    this.policy.assertTicketAccess(user, ticket.rows[0], 'ticket:read');
    const parsedLimit = Number.parseInt(limitValue ?? '100', 10); const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
    const events = await this.db.query<{ id: string; occurred_at: Date; actor_id: string; action: string; target_type: string; target_id: string; correlation_id: string; outcome: string; metadata: Record<string, unknown>; previous_hash: string | null; event_hash: string }>(`SELECT id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash FROM audit_events WHERE target_id=$1 OR metadata->>'ticketId'=$1 OR metadata->>'targetTicketId'=$1 ORDER BY occurred_at ASC LIMIT $2`, [ticketId, limit]);
    await this.db.transaction((client) => this.audit.write(client, { actorId: user.subject, action: auditAction, targetType: 'ticket', targetId: ticketId, correlationId: request.correlationId!, outcome: 'success', metadata: { eventCount: events.rows.length } }));
    return { ticketId, exportedAt: auditAction === 'audit.exported' ? new Date().toISOString() : undefined, events: events.rows.map(({ id, occurred_at, actor_id, action, target_type, target_id, correlation_id, outcome, metadata, previous_hash, event_hash }) => ({ id, occurredAt: occurred_at, actorId: actor_id, action, targetType: target_type, targetId: target_id, correlationId: correlation_id, outcome, metadata, previousHash: previous_hash, eventHash: event_hash })) };
  }
}
