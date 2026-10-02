import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PgService } from '../database/pg.service.js';
import { SlaService } from '../tickets/sla.service.js';
import { EscalationService } from './escalation.service.js';

const LOCK_KEY = 804232;

/**
 * The SLA timer. Each tick re-evaluates SLA status for every open ticket, then runs escalation rules.
 * Opt-in via WORKFLOW_SCHEDULER_ENABLED=true. A transaction-level advisory lock means that when several API
 * instances run, only one executes a given tick; the others skip it.
 * This is the in-app stand-in for the Camunda timer workers planned for the pilot phase.
 */
@Injectable()
export class WorkflowScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly db: PgService, private readonly sla: SlaService, private readonly escalation: EscalationService) {}

  onModuleInit(): void {
    if (process.env.WORKFLOW_SCHEDULER_ENABLED !== 'true' || !process.env.DATABASE_URL) return;
    this.logger.log('Workflow scheduler started');
    this.schedule(5000);
  }

  onModuleDestroy(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }

  /** Exposed so one tick can be run directly (tests, manual triggers). Returns null if another instance holds the lock. */
  async tick(): Promise<{ slaUpdated: number; escalated: number } | null> {
    return this.db.transaction(async (client) => {
      const lock = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY]);
      if (!lock.rows[0].ok) return null;
      const correlationId = `timer-${randomUUID()}`;
      const sla = await this.sla.reconcileSystem(correlationId);
      const escalation = await this.escalation.run(correlationId);
      return { slaUpdated: sla.updated, escalated: escalation.escalated };
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.run(); }, delayMs);
    this.timer.unref();
  }

  private async run(): Promise<void> {
    try {
      const result = await this.tick();
      if (result && (result.slaUpdated || result.escalated)) this.logger.log(`Timer tick: slaUpdated=${result.slaUpdated} escalated=${result.escalated}`);
    } catch (error) { this.logger.error(`Timer tick failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
    this.schedule(Number(process.env.WORKFLOW_TICK_MS ?? 60_000));
  }
}
