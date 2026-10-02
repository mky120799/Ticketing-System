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
      const totals = await client.query<{ total: string; active: string; resolved: string; closed: string; overdue: string }>(`SELECT count(*)::text AS total, count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::text AS active, count(*) FILTER (WHERE status='resolved')::text AS resolved, count(*) FILTER (WHERE status='closed')::text AS closed, count(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND resolution_due_at < now())::text AS overdue FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])`, scope);
      const queues = await client.query<{ queue: string; total: string; active: string; overdue: string }>(`SELECT queue, count(*)::text AS total, count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::text AS active, count(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND resolution_due_at < now())::text AS overdue FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) GROUP BY queue ORDER BY queue`, scope);
      const aging = await client.query<{ bucket: string; count: string }>(`SELECT CASE WHEN now()-created_at < interval '1 day' THEN 'under_1_day' WHEN now()-created_at < interval '3 days' THEN '1_to_3_days' WHEN now()-created_at < interval '7 days' THEN '3_to_7_days' ELSE 'over_7_days' END AS bucket, count(*)::text FROM tickets WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[]) AND status NOT IN ('closed','cancelled') GROUP BY 1 ORDER BY 1`, scope);
      await this.audit.write(client, { actorId: user.subject, action: 'dashboard.viewed', targetType: 'dashboard', targetId: 'case-summary', correlationId, outcome: 'success', metadata: { queueCount: queues.rows.length } });
      const totalsRow = totals.rows[0];
      return { asOf: new Date().toISOString(), totals: { total: Number(totalsRow.total), active: Number(totalsRow.active), resolved: Number(totalsRow.resolved), closed: Number(totalsRow.closed), overdue: Number(totalsRow.overdue) }, queues: queues.rows.map((row) => ({ queue: row.queue, total: Number(row.total), active: Number(row.active), overdue: Number(row.overdue) })), aging: aging.rows.map((row) => ({ bucket: row.bucket, count: Number(row.count) })) };
    });
  }
}
