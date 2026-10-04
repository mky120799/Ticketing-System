import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { LiveEventsService } from '../live/live-events.service.js';

export type NotificationType = 'ticket_assigned' | 'approval_needed' | 'sla_at_risk' | 'regulatory_at_risk' | 'ticket_escalated' | 'customer_replied';
export interface NotificationTarget { user?: string; queue?: string; role?: string; legalEntity: string; country: string; }

/**
 * Staff notification inbox. Notifications carry a title and an optional ticket ID only (no customer content); opening
 * the ticket goes through the normal authorized, audited path. Created inside the same transaction as the event that
 * caused them, and pushed live to connected recipients.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: PgService, private readonly live: LiveEventsService) {}

  async create(client: PoolClient, target: NotificationTarget, type: NotificationType, title: string, ticketId?: string): Promise<void> {
    if (!target.user && !(target.queue && target.role)) return;
    await client.query('INSERT INTO notifications (id,recipient_user,recipient_queue,audience_role,legal_entity,country,type,ticket_id,title) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), target.user ?? null, target.user ? null : target.queue, target.user ? null : target.role, target.legalEntity, target.country, type, ticketId ?? null, title.slice(0, 160)]);
    await this.live.notifyPerson(client, target);
  }

  /** Tells the person working a ticket (if any) and the queue's supervisors that it needs attention. */
  async ticketAttention(client: PoolClient, ticket: { id: string; queue: string; assigned_to: string | null; legal_entity: string; country: string }, type: NotificationType, title: string, options: { assignee?: boolean; supervisors?: boolean } = { assignee: true, supervisors: true }): Promise<void> {
    if (options.assignee !== false && ticket.assigned_to) await this.create(client, { user: ticket.assigned_to, legalEntity: ticket.legal_entity, country: ticket.country }, type, title, ticket.id);
    if (options.supervisors !== false) await this.create(client, { queue: ticket.queue, role: 'supervisor', legalEntity: ticket.legal_entity, country: ticket.country }, type, title, ticket.id);
  }

  async inbox(user: UserContext, limit = 50): Promise<{ notifications: unknown[]; unread: number }> {
    const rows = await this.db.query<{ id: string; type: string; ticket_id: string | null; title: string; created_at: Date; read_at: Date | null }>(
      `SELECT n.id,n.type,n.ticket_id,n.title,n.created_at,r.read_at FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1
       WHERE ${this.audienceSql()} ORDER BY n.created_at DESC LIMIT $6`, [user.subject, user.legalEntity, user.country, user.queues, user.roles, Math.min(Math.max(limit, 1), 100)]);
    const unread = await this.unreadCount(user);
    return { notifications: rows.rows.map((r) => ({ id: r.id, type: r.type, ticketId: r.ticket_id, title: r.title, createdAt: r.created_at, read: r.read_at !== null })), unread };
  }

  async unreadCount(user: UserContext): Promise<number> {
    const result = await this.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE r.read_at IS NULL AND ${this.audienceSql()}`, [user.subject, user.legalEntity, user.country, user.queues, user.roles]);
    return Number(result.rows[0].n);
  }

  async markRead(user: UserContext, ids: string[] | 'all'): Promise<void> {
    await this.db.query(`INSERT INTO notification_reads (notification_id,user_id) SELECT n.id,$1 FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE r.read_at IS NULL AND ${this.audienceSql()} AND ($6::boolean OR n.id = ANY($7::uuid[])) ON CONFLICT DO NOTHING`, [user.subject, user.legalEntity, user.country, user.queues, user.roles, ids === 'all', ids === 'all' ? [] : ids]);
  }

  /** Who a notification is for: addressed to me, or to a role-in-queue that I hold, within my legal entity and country. */
  private audienceSql(): string {
    return `(n.recipient_user = $1 OR (n.recipient_queue = ANY($4::text[]) AND n.audience_role = ANY($5::text[]) AND n.legal_entity = $2 AND n.country = $3))`;
  }
}
