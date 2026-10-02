import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PolicyService, type TicketPolicySubject } from '../auth/policy.service.js';
import { AuditService } from './audit.service.js';
import { PgService } from '../database/pg.service.js';

@Controller('audit')
@UseGuards(AuthGuard)
export class AuditController {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService) {}

  @Get('tickets/:ticketId')
  async ticketReport(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Query('limit') limitValue?: string) {
    return this.report(request, ticketId, limitValue, 'audit.report_viewed');
  }

  @Get('tickets/:ticketId/export')
  async ticketExport(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Query('limit') limitValue?: string) {
    return this.report(request, ticketId, limitValue, 'audit.exported');
  }

  private async report(request: FastifyRequest, ticketId: string, limitValue: string | undefined, auditAction: 'audit.report_viewed' | 'audit.exported') {
    const user = request.user!; this.policy.assertPermission(user, 'audit:read');
    const ticket = await this.db.query<TicketPolicySubject>('SELECT queue,branch_code,department,legal_entity,country,sensitivity,created_by,assigned_to FROM tickets WHERE id=$1', [ticketId]);
    if (!ticket.rows[0]) return { events: [] };
    this.policy.assertTicketAccess(user, ticket.rows[0], 'ticket:read');
    const parsedLimit = Number.parseInt(limitValue ?? '100', 10); const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
    const events = await this.db.query<{ id: string; occurred_at: Date; actor_id: string; action: string; target_type: string; target_id: string; correlation_id: string; outcome: string; metadata: Record<string, unknown>; previous_hash: string | null; event_hash: string }>(`SELECT id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash FROM audit_events WHERE target_id=$1 OR metadata->>'ticketId'=$1 OR metadata->>'targetTicketId'=$1 ORDER BY occurred_at ASC LIMIT $2`, [ticketId, limit]);
    await this.db.transaction((client) => this.audit.write(client, { actorId: user.subject, action: auditAction, targetType: 'ticket', targetId: ticketId, correlationId: request.correlationId!, outcome: 'success', metadata: { eventCount: events.rows.length } }));
    return { ticketId, exportedAt: auditAction === 'audit.exported' ? new Date().toISOString() : undefined, events: events.rows.map(({ id, occurred_at, actor_id, action, target_type, target_id, correlation_id, outcome, metadata, previous_hash, event_hash }) => ({ id, occurredAt: occurred_at, actorId: actor_id, action, targetType: target_type, targetId: target_id, correlationId: correlation_id, outcome, metadata, previousHash: previous_hash, eventHash: event_hash })) };
  }
}
