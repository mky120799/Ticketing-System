import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PgService } from './pg.service.js';

export interface AuditPrivilegeReport { safe: boolean; reasons: string[]; role: string; }

/** Checks whether the account the application runs as could tamper with the audit trail, using privileges the database itself reports. */
export async function checkAuditPrivileges(query: PgService['query']): Promise<AuditPrivilegeReport> {
  const row = (await query<{ role: string; can_update: boolean; can_delete: boolean; can_truncate: boolean; superuser: boolean; owner: boolean }>(
    `SELECT current_user AS role, has_table_privilege(current_user,'audit_events','UPDATE') AS can_update, has_table_privilege(current_user,'audit_events','DELETE') AS can_delete,
            has_table_privilege(current_user,'audit_events','TRUNCATE') AS can_truncate,
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname=current_user), false) AS superuser,
            COALESCE((SELECT pg_get_userbyid(relowner)=current_user FROM pg_class WHERE oid = to_regclass('public.audit_events')), false) AS owner`)).rows[0];
  const reasons = [row.superuser && 'is a superuser', row.owner && 'owns the audit table', row.can_update && 'can UPDATE audit events', row.can_delete && 'can DELETE audit events', row.can_truncate && 'can TRUNCATE audit events'].filter((r): r is string => Boolean(r));
  return { safe: reasons.length === 0, reasons, role: row.role };
}

/**
 * At start-up, reports whether the runtime database account is restricted. In production set
 * AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true to refuse to start otherwise (see infra/postgres/roles.sql).
 */
@Injectable()
export class DatabaseGuardService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseGuardService.name);
  report: AuditPrivilegeReport | null = null;
  constructor(private readonly db: PgService) {}

  async onModuleInit(): Promise<void> {
    if (!process.env.DATABASE_URL) return;
    try { this.report = await checkAuditPrivileges(this.db.query.bind(this.db)); } catch { return; } // table not created yet (first migration run)
    if (this.report.safe) { this.logger.log(`Runtime database role "${this.report.role}" cannot alter the audit trail`); return; }
    const message = `Runtime database role "${this.report.role}" could tamper with the audit trail (${this.report.reasons.join(', ')}). Use the restricted account from infra/postgres/roles.sql.`;
    if (process.env.AUDIT_REQUIRE_RESTRICTED_DB_ROLE === 'true') throw new Error(message);
    this.logger.warn(message);
  }
}
