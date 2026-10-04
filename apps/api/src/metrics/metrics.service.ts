import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { PgService } from '../database/pg.service.js';
import { DatabaseGuardService } from '../database/database-guard.service.js';
import { AuditIntegrityService } from '../audit/audit-integrity.service.js';
import { LiveEventsService } from '../live/live-events.service.js';

/**
 * Prometheus metrics. Labels are deliberately low-cardinality (route pattern, never raw URLs or IDs) and carry
 * no customer data. Business gauges are computed at scrape time so they are always consistent with the database.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({ name: 'http_requests_total', help: 'HTTP requests', labelNames: ['method', 'route', 'status'] as const, registers: [this.registry] });
  readonly httpDuration = new Histogram({ name: 'http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route'] as const, buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [this.registry] });

  constructor(private readonly db: PgService, private readonly live: LiveEventsService, private readonly integrity: AuditIntegrityService, private readonly dbGuard: DatabaseGuardService) {
    collectDefaultMetrics({ register: this.registry });
    new Gauge({ name: 'outbox_events', help: 'Integration outbox rows by status', labelNames: ['status'] as const, registers: [this.registry] });
    this.outboxGauge = this.registry.getSingleMetric('outbox_events') as Gauge<string>;
    new Gauge({ name: 'live_event_streams', help: 'Connected SSE streams on this instance', registers: [this.registry] });
    this.streamGauge = this.registry.getSingleMetric('live_event_streams') as Gauge<string>;
    new Gauge({ name: 'audit_chain_valid', help: '1 if the last audit verification passed, 0 if it failed', registers: [this.registry] });
    new Gauge({ name: 'audit_chain_verified_sequence', help: 'Highest audit sequence verified', registers: [this.registry] });
    new Gauge({ name: 'audit_chain_last_verified_timestamp_seconds', help: 'When the audit chain was last verified', registers: [this.registry] });
    this.auditValid = this.registry.getSingleMetric('audit_chain_valid') as Gauge<string>; this.auditSeq = this.registry.getSingleMetric('audit_chain_verified_sequence') as Gauge<string>; this.auditAt = this.registry.getSingleMetric('audit_chain_last_verified_timestamp_seconds') as Gauge<string>;
    new Gauge({ name: 'audit_runtime_role_safe', help: '1 if the application database account cannot alter the audit trail', registers: [this.registry] });
    this.roleSafe = this.registry.getSingleMetric('audit_runtime_role_safe') as Gauge<string>;
    new Gauge({ name: 'communications', help: 'Customer communications by status', labelNames: ['status'] as const, registers: [this.registry] });
    this.commsGauge = this.registry.getSingleMetric('communications') as Gauge<string>;
    new Gauge({ name: 'attachments_pending_scan', help: 'Uploaded attachments waiting for a malware scan', registers: [this.registry] });
    new Gauge({ name: 'attachments_oldest_pending_scan_seconds', help: 'Age of the oldest attachment still waiting for a malware scan (alert if this grows: the scanner may be down)', registers: [this.registry] });
    this.scanPending = this.registry.getSingleMetric('attachments_pending_scan') as Gauge<string>; this.scanAge = this.registry.getSingleMetric('attachments_oldest_pending_scan_seconds') as Gauge<string>;
    new Gauge({ name: 'tickets_open', help: 'Open tickets by SLA status', labelNames: ['sla_status'] as const, registers: [this.registry] });
    this.ticketGauge = this.registry.getSingleMetric('tickets_open') as Gauge<string>;
  }
  private scanPending: Gauge<string>; private scanAge: Gauge<string>; private commsGauge: Gauge<string>; private roleSafe: Gauge<string>; private auditValid: Gauge<string>; private auditSeq: Gauge<string>; private auditAt: Gauge<string>; private outboxGauge: Gauge<string>; private streamGauge: Gauge<string>; private ticketGauge: Gauge<string>;

  async render(): Promise<string> {
    const outbox = await this.db.query<{ status: string; count: string }>('SELECT status, count(*)::text AS count FROM integration_outbox GROUP BY status');
    const seen = new Map(outbox.rows.map((row) => [row.status, Number(row.count)]));
    for (const status of ['pending', 'in_flight', 'retry', 'dead_letter']) this.outboxGauge.set({ status }, seen.get(status) ?? 0);
    const tickets = await this.db.query<{ sla_status: string; count: string }>("SELECT COALESCE(sla_status,'unknown') AS sla_status, count(*)::text AS count FROM tickets WHERE status NOT IN ('closed','cancelled') GROUP BY 1");
    this.ticketGauge.reset(); for (const row of tickets.rows) this.ticketGauge.set({ sla_status: row.sla_status }, Number(row.count));
    this.streamGauge.set(this.live.streamCount());
    const comms = await this.db.query<{ status: string; count: string }>('SELECT status, count(*)::text AS count FROM ticket_communications GROUP BY status');
    this.commsGauge.reset(); for (const row of comms.rows) this.commsGauge.set({ status: row.status }, Number(row.count));
    const scans = (await this.db.query<{ n: string; age: string | null }>("SELECT count(*)::text AS n, extract(epoch FROM now() - min(updated_at))::text AS age FROM attachments WHERE upload_status='uploaded' AND malware_status='pending_scan'")).rows[0];
    this.scanPending.set(Number(scans.n)); this.scanAge.set(scans.age ? Math.round(Number(scans.age)) : 0);
    if (this.dbGuard.report) this.roleSafe.set(this.dbGuard.report.safe ? 1 : 0);
    const audit = (await this.integrity.latest()).verification;
    if (audit) { this.auditValid.set(audit.status === 'valid' ? 1 : 0); this.auditSeq.set(audit.verifiedThroughSequence); this.auditAt.set(Math.floor(new Date(audit.verifiedAt).getTime() / 1000)); }
    return this.registry.metrics();
  }
}
