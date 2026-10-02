import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OUTBOX_PUBLISHER } from './outbox-publishers.js';
import { OutboxService, type OutboxPublisher } from './outbox.service.js';

const BATCH_SIZE = 25;
const STALE_RELEASE_EVERY_MS = 60_000;

/**
 * Background loop that drains integration_outbox through the configured publisher.
 * Opt-in via OUTBOX_DISPATCHER_ENABLED=true so tests and one-off scripts never race it.
 * Safe to run on every API instance: rows are claimed with FOR UPDATE SKIP LOCKED.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastStaleRelease = 0;

  constructor(private readonly outbox: OutboxService, @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_DISPATCHER_ENABLED !== 'true' || !process.env.DATABASE_URL) return;
    this.logger.log(`Outbox dispatcher started (${process.env.OUTBOX_PUBLISHER ?? 'log'} publisher)`);
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await (this.publisher as { close?: () => Promise<void> }).close?.();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.tick(); }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    let busy = false;
    try {
      if (Date.now() - this.lastStaleRelease > STALE_RELEASE_EVERY_MS) {
        this.lastStaleRelease = Date.now();
        const released = await this.outbox.releaseStale(Number(process.env.OUTBOX_STALE_SECONDS ?? 300));
        if (released) this.logger.warn(`Released ${released} stale in-flight outbox event(s) for retry`);
      }
      const result = await this.outbox.processBatch(this.publisher, BATCH_SIZE);
      if (result.retried || result.deadLettered) this.logger.warn(`Outbox batch: published=${result.published} retried=${result.retried} deadLettered=${result.deadLettered}`);
      busy = result.claimed === BATCH_SIZE; // a full batch means more may be waiting; go again immediately
    } catch (error) {
      this.logger.error(`Outbox dispatch failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    this.schedule(busy ? 0 : Number(process.env.OUTBOX_POLL_MS ?? 2000));
  }
}
