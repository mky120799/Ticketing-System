import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { UpsertAssignmentRuleDto, UpsertEscalationRuleDto, UpsertIntakeChannelDto, UpsertQueueMemberDto } from './routing.dto.js';

/** Administrator-only management of who receives work and where overdue work goes. Never touches ticket content. */
@Injectable()
export class RoutingConfigurationService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async listMembers(user: UserContext, queueKey: string): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    await this.assertQueueInScope(this.db, user, queueKey);
    const result = await this.db.query<{ user_id: string; active: boolean; last_assigned_at: Date | null }>('SELECT user_id,active,last_assigned_at FROM queue_members WHERE queue_key=$1 ORDER BY user_id', [queueKey]);
    return result.rows.map(({ user_id, active, last_assigned_at }) => ({ userId: user_id, active, lastAssignedAt: last_assigned_at }));
  }

  async listAssignmentRules(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ rule_key: string; queue_key: string; category: string | null; priority: string | null; strategy: string; sort_order: number; active: boolean }>(
      'SELECT r.rule_key,r.queue_key,r.category,r.priority,r.strategy,r.sort_order,r.active FROM assignment_rules r JOIN case_queues q ON q.queue_key=r.queue_key WHERE q.legal_entity=$1 AND q.country=$2 ORDER BY r.queue_key,r.sort_order,r.rule_key', [user.legalEntity, user.country]);
    return result.rows.map((row) => ({ ruleKey: row.rule_key, queue: row.queue_key, category: row.category, priority: row.priority, strategy: row.strategy, sortOrder: row.sort_order, active: row.active }));
  }

  async listEscalationRules(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ rule_key: string; queue_key: string; trigger: string; escalate_to_queue: string; raise_priority: boolean; active: boolean }>(
      'SELECT r.rule_key,r.queue_key,r.trigger,r.escalate_to_queue,r.raise_priority,r.active FROM escalation_rules r JOIN case_queues q ON q.queue_key=r.queue_key WHERE q.legal_entity=$1 AND q.country=$2 ORDER BY r.queue_key,r.rule_key', [user.legalEntity, user.country]);
    return result.rows.map((row) => ({ ruleKey: row.rule_key, queue: row.queue_key, trigger: row.trigger, escalateToQueue: row.escalate_to_queue, raisePriority: row.raise_priority, active: row.active }));
  }

  async upsertMember(user: UserContext, queueKey: string, userId: string, dto: UpsertQueueMemberDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!/^[A-Za-z0-9._:@-]{1,160}$/.test(userId)) throw new ConflictException('User ID is invalid');
    return this.db.transaction(async (client) => {
      await this.assertQueueInScope(client, user, queueKey);
      await client.query(`INSERT INTO queue_members (queue_key,user_id,active,updated_by) VALUES ($1,$2,$3,$4)
        ON CONFLICT (queue_key,user_id) DO UPDATE SET active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`, [queueKey, userId, dto.active, user.subject]);
      await this.record(client, user, correlationId, 'queue_member', 'queue_member', `${queueKey}:${userId}`, { queue: queueKey, userId, active: dto.active });
      return { queue: queueKey, userId, active: dto.active };
    });
  }

  async upsertAssignmentRule(user: UserContext, ruleKey: string, dto: UpsertAssignmentRuleDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(ruleKey);
    return this.db.transaction(async (client) => {
      await this.assertQueueInScope(client, user, dto.queue);
      if (dto.category) {
        const category = await client.query('SELECT 1 FROM ticket_categories WHERE category_key=$1 AND active=true', [dto.category]);
        if (!category.rowCount) throw new ConflictException('Category does not exist or is inactive');
      }
      await this.assertRuleOwnedInScope(client, user, 'assignment_rules', ruleKey);
      await client.query(`INSERT INTO assignment_rules (rule_key,queue_key,category,priority,strategy,sort_order,active,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (rule_key) DO UPDATE SET queue_key=EXCLUDED.queue_key, category=EXCLUDED.category, priority=EXCLUDED.priority, strategy=EXCLUDED.strategy, sort_order=EXCLUDED.sort_order, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [ruleKey, dto.queue, dto.category ?? null, dto.priority ?? null, dto.strategy, dto.sortOrder, dto.active, user.subject]);
      const view = { ruleKey, queue: dto.queue, category: dto.category ?? null, priority: dto.priority ?? null, strategy: dto.strategy, sortOrder: dto.sortOrder, active: dto.active };
      await this.record(client, user, correlationId, 'assignment_rule', 'assignment_rule', ruleKey, view);
      return view;
    });
  }

  async upsertEscalationRule(user: UserContext, ruleKey: string, dto: UpsertEscalationRuleDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(ruleKey);
    if (dto.queue === dto.escalateToQueue) throw new ConflictException('A queue cannot escalate to itself');
    return this.db.transaction(async (client) => {
      await this.assertQueueInScope(client, user, dto.queue);
      await this.assertQueueInScope(client, user, dto.escalateToQueue);
      await this.assertRuleOwnedInScope(client, user, 'escalation_rules', ruleKey);
      await client.query(`INSERT INTO escalation_rules (rule_key,queue_key,trigger,escalate_to_queue,raise_priority,active,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (rule_key) DO UPDATE SET queue_key=EXCLUDED.queue_key, trigger=EXCLUDED.trigger, escalate_to_queue=EXCLUDED.escalate_to_queue, raise_priority=EXCLUDED.raise_priority, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [ruleKey, dto.queue, dto.trigger, dto.escalateToQueue, dto.raisePriority, dto.active, user.subject]);
      const view = { ruleKey, queue: dto.queue, trigger: dto.trigger, escalateToQueue: dto.escalateToQueue, raisePriority: dto.raisePriority, active: dto.active };
      await this.record(client, user, correlationId, 'escalation_rule', 'escalation_rule', ruleKey, view);
      return view;
    });
  }

  async listIntakeChannels(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ channel_key: string; default_category: string; default_queue: string; branch_code: string; default_priority: string; active: boolean }>(
      'SELECT c.channel_key,c.default_category,c.default_queue,c.branch_code,c.default_priority,c.active FROM intake_channels c JOIN case_queues q ON q.queue_key=c.default_queue WHERE q.legal_entity=$1 AND q.country=$2 ORDER BY c.channel_key', [user.legalEntity, user.country]);
    return result.rows.map((row) => ({ channel: row.channel_key, defaultCategory: row.default_category, defaultQueue: row.default_queue, branchCode: row.branch_code, defaultPriority: row.default_priority, active: row.active }));
  }

  async upsertIntakeChannel(user: UserContext, channel: string, dto: UpsertIntakeChannelDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    if (!['email', 'portal', 'mobile', 'phone', 'internal'].includes(channel)) throw new ConflictException('Unknown intake channel');
    return this.db.transaction(async (client) => {
      await this.assertQueueInScope(client, user, dto.defaultQueue);
      const category = await client.query('SELECT 1 FROM ticket_categories WHERE category_key=$1 AND active=true', [dto.defaultCategory]);
      if (!category.rowCount) throw new ConflictException('Default category does not exist or is inactive');
      const existing = (await client.query<{ legal_entity: string; country: string }>('SELECT q.legal_entity,q.country FROM intake_channels c JOIN case_queues q ON q.queue_key=c.default_queue WHERE c.channel_key=$1', [channel])).rows[0];
      if (existing && (existing.legal_entity !== user.legalEntity || existing.country !== user.country)) throw new ForbiddenException('Channel belongs to another legal entity or country');
      await client.query(`INSERT INTO intake_channels (channel_key,default_category,default_queue,branch_code,default_priority,active,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (channel_key) DO UPDATE SET default_category=EXCLUDED.default_category, default_queue=EXCLUDED.default_queue, branch_code=EXCLUDED.branch_code, default_priority=EXCLUDED.default_priority, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [channel, dto.defaultCategory, dto.defaultQueue, dto.branchCode, dto.defaultPriority, dto.active, user.subject]);
      const view = { channel, defaultCategory: dto.defaultCategory, defaultQueue: dto.defaultQueue, branchCode: dto.branchCode, defaultPriority: dto.defaultPriority, active: dto.active };
      await this.record(client, user, correlationId, 'intake_channel', 'intake_channel', channel, view);
      return view;
    });
  }

  private async assertQueueInScope(runner: { query: PgService['query'] }, user: UserContext, queueKey: string): Promise<void> {
    const queue = (await runner.query<{ legal_entity: string; country: string; active: boolean }>('SELECT legal_entity,country,active FROM case_queues WHERE queue_key=$1', [queueKey])).rows[0];
    if (!queue || !queue.active) throw new ConflictException(`Queue ${queueKey} does not exist or is inactive`);
    if (queue.legal_entity !== user.legalEntity || queue.country !== user.country) throw new ForbiddenException('Queue is outside your legal entity or country');
  }

  /** An existing rule may only be edited by an administrator of the entity that owns its queue. */
  private async assertRuleOwnedInScope(client: PoolClient, user: UserContext, table: 'assignment_rules' | 'escalation_rules', ruleKey: string): Promise<void> {
    const existing = (await client.query<{ legal_entity: string; country: string }>(`SELECT q.legal_entity,q.country FROM ${table} r JOIN case_queues q ON q.queue_key=r.queue_key WHERE r.rule_key=$1`, [ruleKey])).rows[0];
    if (existing && (existing.legal_entity !== user.legalEntity || existing.country !== user.country)) throw new ForbiddenException('Rule belongs to another legal entity or country');
  }

  private assertKey(value: string): void {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length < 2 || value.length > 80) throw new ConflictException('Configuration key is invalid');
  }

  private async record(client: PoolClient, user: UserContext, correlationId: string, kind: string, aggregateType: string, id: string, data: Record<string, string | number | boolean | null>): Promise<void> {
    await this.audit.write(client, { actorId: user.subject, action: `configuration.${kind}_updated`, targetType: kind, targetId: id, correlationId, outcome: 'success', metadata: data });
    await this.outbox.enqueue(client, { eventType: `configuration.${kind}_changed`, aggregateType, aggregateId: id, correlationId, payload: data });
  }
}
