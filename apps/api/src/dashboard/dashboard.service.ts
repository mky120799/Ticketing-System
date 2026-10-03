import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PgService } from '../database/pg.service.js';
import { PolicyService } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';

@Injectable()
export class DashboardService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService) {}

  async summary(user: UserContext, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'dashboard:read');
    return this.db.transaction(async (client) => {
      const scope = [user.legalEntity, user.country, user.queues];
      const totals = await client.query<{ total: string; active: string; resolved: string; closed: string; overdue: string }>(`SELECT count(*)::text AS total, count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::text AS active, count(*) FILTER (WHERE status='resolved')::text AS resolved, count(*) FILTER (WHERE status='closed')::text AS closed, count(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND resolved_at IS NULL AND resolution_due_at < now())::text AS overdue FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])`, scope);
      const queues = await client.query<{ queue: string; total: string; active: string; overdue: string }>(`SELECT queue, count(*)::text AS total, count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::text AS active, count(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND resolved_at IS NULL AND resolution_due_at < now())::text AS overdue FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) GROUP BY queue ORDER BY queue`, scope);
      const aging = await client.query<{ bucket: string; count: string }>(`SELECT CASE WHEN now()-created_at < interval '1 day' THEN 'under_1_day' WHEN now()-created_at < interval '3 days' THEN '1_to_3_days' WHEN now()-created_at < interval '7 days' THEN '3_to_7_days' ELSE 'over_7_days' END AS bucket, count(*)::text FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) AND status NOT IN ('closed','cancelled') GROUP BY 1 ORDER BY 1`, scope);
      const window = "interval '30 days'";
      const sla = await client.query<{ resolved: string; on_time: string; responded: string; responded_on_time: string; avg_first_response_minutes: string | null }>(`SELECT
          count(*) FILTER (WHERE resolved_at >= now() - ${window})::text AS resolved,
          count(*) FILTER (WHERE resolved_at >= now() - ${window} AND resolved_at <= resolution_due_at)::text AS on_time,
          count(*) FILTER (WHERE first_responded_at >= now() - ${window})::text AS responded,
          count(*) FILTER (WHERE first_responded_at >= now() - ${window} AND first_responded_at <= first_response_due_at)::text AS responded_on_time,
          avg(extract(epoch FROM first_responded_at - created_at) / 60) FILTER (WHERE first_responded_at >= now() - ${window})::text AS avg_first_response_minutes
        FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])`, scope);
      const escalations = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ticket_escalations e JOIN tickets t ON t.id=e.ticket_id WHERE e.created_at >= now() - ${window} AND t.legal_entity=$1 AND t.country=$2 AND t.queue = ANY($3::text[])`, scope);
      const rootCauses = await client.query<{ cause: string; count: string }>(`SELECT root_cause AS cause, count(*)::text AS count FROM tickets WHERE root_cause IS NOT NULL AND resolved_at >= now() - ${window} AND legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) GROUP BY 1 ORDER BY count(*) DESC`, scope);
      const channels = await client.query<{ channel: string; count: string }>(`SELECT source_channel AS channel, count(*)::text AS count FROM tickets WHERE created_at >= now() - ${window} AND legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) GROUP BY 1 ORDER BY count(*) DESC`, scope);
      const complaints = await client.query<{ open: string; ack_overdue: string; at_risk: string; overdue: string; vulnerable: string; afca: string }>(`SELECT count(*)::text AS open, count(*) FILTER (WHERE regulatory_status='ack_overdue')::text AS ack_overdue, count(*) FILTER (WHERE regulatory_status='at_risk')::text AS at_risk, count(*) FILTER (WHERE regulatory_status='final_response_overdue')::text AS overdue, count(*) FILTER (WHERE vulnerability_flag)::text AS vulnerable, count(*) FILTER (WHERE afca_status IN ('referred','open'))::text AS afca FROM tickets WHERE is_complaint=true AND resolved_at IS NULL AND status NOT IN ('closed','cancelled') AND legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])`, scope);
      const c = complaints.rows[0];
      const pct = (part: string, whole: string) => (Number(whole) ? Math.round((Number(part) / Number(whole)) * 100) : null);
      const s = sla.rows[0];
      await this.audit.write(client, { actorId: user.subject, action: 'dashboard.viewed', targetType: 'dashboard', targetId: 'case-summary', correlationId, outcome: 'success', metadata: { queueCount: queues.rows.length } });
      const totalsRow = totals.rows[0];
      return { asOf: new Date().toISOString(), totals: { total: Number(totalsRow.total), active: Number(totalsRow.active), resolved: Number(totalsRow.resolved), closed: Number(totalsRow.closed), overdue: Number(totalsRow.overdue) }, queues: queues.rows.map((row) => ({ queue: row.queue, total: Number(row.total), active: Number(row.active), overdue: Number(row.overdue) })), aging: aging.rows.map((row) => ({ bucket: row.bucket, count: Number(row.count) })), complaints: { open: Number(c.open), ackOverdue: Number(c.ack_overdue), atRisk: Number(c.at_risk), finalResponseOverdue: Number(c.overdue), vulnerable: Number(c.vulnerable), withExternalDisputeScheme: Number(c.afca) }, last30Days: { resolved: Number(s.resolved), resolvedOnTimePercent: pct(s.on_time, s.resolved), firstResponseOnTimePercent: pct(s.responded_on_time, s.responded), avgFirstResponseMinutes: s.avg_first_response_minutes === null ? null : Math.round(Number(s.avg_first_response_minutes)), escalations: Number(escalations.rows[0].count), rootCauses: rootCauses.rows.map((row) => ({ cause: row.cause, count: Number(row.count) })), channels: channels.rows.map((row) => ({ channel: row.channel, count: Number(row.count) })) } };
    });
  }
}
