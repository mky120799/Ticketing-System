import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, type PoolClient } from 'pg';
import { PolicyService, type TicketPolicySubject } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';

export type LiveEventType = 'ticket.created' | 'ticket.updated' | 'ticket.assigned' | 'ticket.status_changed' | 'ticket.note_added' | 'ticket.escalated' | 'ticket.sla_changed';
export interface LiveTicket extends TicketPolicySubject { id: string; status: string; }

/** What a browser receives: opaque ID, event kind, status. Never ticket content. */
export interface LiveEventPayload { type: LiveEventType; ticketId: string; status: string; at: string; }
export type LiveFrame = { event: 'ticket'; data: LiveEventPayload } | { event: 'resync'; data: Record<string, never> };

interface Subscriber { user: UserContext; send: (frame: LiveFrame) => void; }
/** Wire format on the Postgres channel: the public payload plus the scope used to filter it. */
interface NotifyMessage { payload: LiveEventPayload; scope: TicketPolicySubject; previousScope?: TicketPolicySubject; }

const CHANNEL = 'ticket_live';
const MAX_STREAMS_PER_USER = 5;

/**
 * Pushes minimized ticket-change notifications to connected browsers.
 *
 * Producer side: business transactions call notify(), which issues pg_notify inside the
 * same transaction. PostgreSQL delivers NOTIFY only on COMMIT, so a rolled-back change can
 * never reach a browser. Consumer side: every API instance holds one LISTEN connection and
 * fans each message out to its own SSE subscribers, so multiple instances need no extra broker.
 * Each subscriber is re-checked against the same ticket policy used by the REST API.
 */
@Injectable()
export class LiveEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly subscribers = new Set<Subscriber>();
  private listener: Client | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private stopped = false;
  private hasConnectedBefore = false;

  constructor(private readonly policy: PolicyService) {}

  async notify(client: PoolClient, type: LiveEventType, ticket: LiveTicket, previousQueue?: string): Promise<void> {
    const { id, status } = ticket;
    const message: NotifyMessage = { payload: { type, ticketId: id, status, at: new Date().toISOString() }, scope: this.scopeOf(ticket) };
    if (previousQueue && previousQueue !== ticket.queue) message.previousScope = { ...message.scope, queue: previousQueue };
    await client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(message)]);
  }

  subscribe(user: UserContext, send: (frame: LiveFrame) => void): () => void {
    const open = [...this.subscribers].filter((subscriber) => subscriber.user.subject === user.subject).length;
    if (open >= MAX_STREAMS_PER_USER) throw new HttpException('Too many live streams for this user', HttpStatus.TOO_MANY_REQUESTS);
    const subscriber: Subscriber = { user, send };
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  streamCount(): number { return this.subscribers.size; }

  onModuleInit(): void { if (process.env.DATABASE_URL) void this.connect(); }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.subscribers.clear();
    const listener = this.listener; this.listener = null;
    if (listener) await listener.end().catch(() => undefined);
  }

  private scopeOf(ticket: TicketPolicySubject): TicketPolicySubject {
    const { queue, branch_code, department, legal_entity, country, sensitivity, created_by, assigned_to } = ticket;
    return { queue, branch_code, department, legal_entity, country, sensitivity, created_by, assigned_to };
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    const lost = () => { if (this.listener === client) this.listener = null; this.scheduleReconnect(); };
    client.on('error', lost); client.on('end', lost);
    client.on('notification', (message) => { if (message.channel === CHANNEL && message.payload) this.dispatch(message.payload); });
    try {
      await client.connect();
      // The application may have shut down while we were connecting; do not leave an orphaned connection behind.
      if (this.stopped) { await client.end().catch(() => undefined); return; }
      await client.query(`LISTEN ${CHANNEL}`);
      this.listener = client; this.attempt = 0;
      // Events raised while the listener was down are gone; tell clients to refetch.
      if (this.hasConnectedBefore) this.broadcast({ event: 'resync', data: {} });
      this.hasConnectedBefore = true;
    } catch { await client.end().catch(() => undefined); this.scheduleReconnect(); }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.logger.warn(`Live-event listener disconnected; retrying in ${delay} ms`);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(); }, delay);
    this.retryTimer.unref();
  }

  private dispatch(raw: string): void {
    let message: NotifyMessage;
    try { message = JSON.parse(raw) as NotifyMessage; } catch { return; }
    for (const subscriber of this.subscribers) {
      if (this.canSee(subscriber.user, message.scope) || (message.previousScope && this.canSee(subscriber.user, message.previousScope))) this.safeSend(subscriber, { event: 'ticket', data: message.payload });
    }
  }

  private canSee(user: UserContext, scope: TicketPolicySubject): boolean {
    try { this.policy.assertTicketAccess(user, scope, 'ticket:read'); return true; } catch { return false; }
  }

  private broadcast(frame: LiveFrame): void { for (const subscriber of this.subscribers) this.safeSend(subscriber, frame); }
  private safeSend(subscriber: Subscriber, frame: LiveFrame): void { try { subscriber.send(frame); } catch { this.subscribers.delete(subscriber); } }
}
