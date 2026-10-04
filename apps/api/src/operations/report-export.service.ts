import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { toCsv } from '../compliance/csv.js';
import { PgService } from '../database/pg.service.js';
import { AttachmentStorageService } from '../storage/attachment-storage.service.js';

export const REPORT_ACTOR = 'system:report-export';

/**
 * Daily scoped exports to object storage for each legal entity and country: the complaints register for the last 30 days
 * and weekly volumes. Classifications, dates, outcomes and opaque IDs only. A reporting tool or a person with bucket access
 * can pick them up without an interactive login. Needs object storage; does nothing without it.
 */
@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);
  constructor(private readonly db: PgService, private readonly audit: AuditService, private readonly storage: AttachmentStorageService) {}

  async runOnce(now = new Date()): Promise<{ files: number }> {
    const scopes = await this.db.query<{ legal_entity: string; country: string }>('SELECT DISTINCT legal_entity,country FROM case_queues WHERE active=true');
    const day = now.toISOString().slice(0, 10); let files = 0;
    for (const scope of scopes.rows) {
      const prefix = `reports/${scope.legal_entity}-${scope.country}/${day}`;
      const complaints = await this.db.query<Record<string, unknown>>(`SELECT id,category,source_channel,priority,status,regulatory_profile,regulatory_status,created_at AS received_at,acknowledge_due_at,first_responded_at AS acknowledged_at,final_response_due_at,resolved_at AS final_response_at,idr_outcome,root_cause,vulnerability_flag,systemic_issue,afca_status FROM tickets WHERE is_complaint=true AND legal_entity=$1 AND country=$2 AND created_at >= $3::timestamptz - interval '30 days' ORDER BY created_at LIMIT 50000`, [scope.legal_entity, scope.country, now.toISOString()]);
      const weekly = await this.db.query<Record<string, unknown>>(`SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS created, count(resolved_at)::int AS resolved, count(*) FILTER (WHERE is_complaint)::int AS complaints FROM tickets WHERE legal_entity=$1 AND country=$2 AND created_at >= $3::timestamptz - interval '12 weeks' GROUP BY 1 ORDER BY 1`, [scope.legal_entity, scope.country, now.toISOString()]);
      for (const [name, rows] of [['complaints-register', complaints.rows], ['weekly-volumes', weekly.rows]] as const) {
        const key = await this.storage.putText(`${prefix}/${name}.csv`, toCsv(rows), 'text/csv').catch((error: unknown) => { this.logger.warn(`Report upload failed: ${error instanceof Error ? error.message : 'unknown error'}`); return null; });
        if (key) files++;
      }
      if (files) await this.db.transaction((client) => this.audit.write(client, { actorId: REPORT_ACTOR, action: 'report.exported_scheduled', targetType: 'report', targetId: `${scope.legal_entity}-${scope.country}`, correlationId: `report-${randomUUID()}`, outcome: 'success', metadata: { day, complaintRows: complaints.rows.length } }));
    }
    return { files };
  }
}
