import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../database/pg.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PolicyService } from '../auth/policy.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { UpsertCategoryDto, UpsertQueueDto } from './configuration.dto.js';
import type { UpsertSlaPolicyDto } from './sla-policy.dto.js';
import type { UpsertCommunicationTemplateDto } from './communication-template.dto.js';
import { RedisCacheService } from '../cache/redis-cache.service.js';

const COMMUNICATION_TEMPLATES_CACHE_KEY = 'configuration:communication-templates:v1';

@Injectable()
export class CaseConfigurationService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly cache: RedisCacheService) {}

  async assertTicketSelection(client: PoolClient, user: UserContext, category: string, queue: string, department: string): Promise<void> {
    const result = await client.query<{ category_key: string }>(`SELECT c.category_key FROM ticket_categories c JOIN case_queues q ON q.queue_key=c.default_queue WHERE c.category_key=$1 AND c.active=true AND q.queue_key=$2 AND q.department=$3 AND q.legal_entity=$4 AND q.country=$5 AND q.active=true`, [category, queue, department, user.legalEntity, user.country]);
    if (!result.rows[0]) throw new ConflictException('Category, queue, department, and entity are not an active compatible configuration');
  }

  /** Administrator view of every SLA policy, for the configuration screen. */
  async listSlaPolicies(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ policy_key: string; priority: string; first_response_minutes: number; resolution_minutes: number; active: boolean; calendar: string; pause_while_pending_customer: boolean }>('SELECT policy_key,priority,first_response_minutes,resolution_minutes,active,calendar,pause_while_pending_customer FROM sla_policies ORDER BY policy_key, array_position(ARRAY[\'low\',\'normal\',\'high\',\'critical\'], priority)');
    return result.rows.map((r) => ({ policyKey: r.policy_key, priority: r.priority, firstResponseMinutes: r.first_response_minutes, resolutionMinutes: r.resolution_minutes, active: r.active, calendar: r.calendar, pauseWhilePendingCustomer: r.pause_while_pending_customer }));
  }

  /** Administrator view of every template including inactive ones and their wording. */
  async listCommunicationTemplatesAdmin(user: UserContext): Promise<unknown[]> {
    this.policy.assertPermission(user, 'configuration:write');
    const result = await this.db.query<{ template_key: string; channel: string; active: boolean; requires_approval: boolean; subject_template: string | null; body_template: string | null }>('SELECT template_key,channel,active,requires_approval,subject_template,body_template FROM communication_templates ORDER BY template_key');
    return result.rows.map((r) => ({ templateKey: r.template_key, channel: r.channel, active: r.active, requiresApproval: r.requires_approval, subjectTemplate: r.subject_template, bodyTemplate: r.body_template }));
  }

  async queues(user: UserContext): Promise<unknown[]> {
    const result = await this.db.query<{ queue_key: string; department: string }>('SELECT queue_key,department FROM case_queues WHERE queue_key=ANY($1::text[]) AND legal_entity=$2 AND country=$3 AND active=true ORDER BY queue_key', [user.queues, user.legalEntity, user.country]);
    return result.rows.map(({ queue_key, department }) => ({ queue: queue_key, department }));
  }

  async categories(user: UserContext): Promise<unknown[]> {
    const result = await this.db.query<{ category_key: string; default_queue: string }>('SELECT c.category_key,c.default_queue FROM ticket_categories c JOIN case_queues q ON q.queue_key=c.default_queue WHERE c.active=true AND q.queue_key=ANY($1::text[]) AND q.legal_entity=$2 AND q.country=$3 AND q.active=true ORDER BY c.category_key', [user.queues, user.legalEntity, user.country]);
    return result.rows.map(({ category_key, default_queue }) => ({ category: category_key, defaultQueue: default_queue }));
  }

  async communicationTemplates(user: UserContext): Promise<unknown[]> {
    if (!this.policy.has(user, 'ticket:read') && !this.policy.has(user, 'configuration:write')) throw new ForbiddenException('Permission denied');
    const cached = await this.cache.getJson<unknown[]>(COMMUNICATION_TEMPLATES_CACHE_KEY);
    if (cached) return cached;
    const result = await this.db.query<{ template_key: string; channel: string; active: boolean; requires_approval: boolean }>('SELECT template_key,channel,active,requires_approval FROM communication_templates WHERE active=true ORDER BY template_key');
    const templates = result.rows.map(({ template_key, channel, active, requires_approval }) => ({ templateKey: template_key, channel, active, requiresApproval: requires_approval }));
    await this.cache.setJson(COMMUNICATION_TEMPLATES_CACHE_KEY, templates, 30);
    return templates;
  }

  async upsertQueue(user: UserContext, queueKey: string, dto: UpsertQueueDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(queueKey, 80);
    this.assertScope(user, dto.legalEntity, dto.country);
    return this.db.transaction(async (client) => {
      const previous = await this.audit.previous(client, 'case_queues', 'queue_key=$1', [queueKey]);
      const result = await client.query<{ queue_key: string; department: string; legal_entity: string; country: string; active: boolean }>(`INSERT INTO case_queues (queue_key,department,legal_entity,country,active,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (queue_key) DO UPDATE SET department=EXCLUDED.department, legal_entity=EXCLUDED.legal_entity, country=EXCLUDED.country, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING queue_key,department,legal_entity,country,active`, [queueKey, dto.department, dto.legalEntity, dto.country, dto.active, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.queue_updated', targetType: 'queue', targetId: queueKey, correlationId, outcome: 'success', metadata: { previous, department: dto.department, legalEntity: dto.legalEntity, country: dto.country, active: dto.active } });
      await this.outbox.enqueue(client, { eventType: 'configuration.queue_changed', aggregateType: 'queue', aggregateId: queueKey, correlationId, payload: { queue: queueKey, department: dto.department, legalEntity: dto.legalEntity, country: dto.country, active: dto.active } });
      const row = result.rows[0];
      return { queue: row.queue_key, department: row.department, legalEntity: row.legal_entity, country: row.country, active: row.active };
    });
  }

  async upsertCategory(user: UserContext, categoryKey: string, dto: UpsertCategoryDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(categoryKey, 80);
    return this.db.transaction(async (client) => {
      const previous = await this.audit.previous(client, 'ticket_categories', 'category_key=$1', [categoryKey]);
      const queue = await client.query<{ legal_entity: string; country: string }>('SELECT legal_entity,country FROM case_queues WHERE queue_key=$1', [dto.defaultQueue]);
      if (!queue.rows[0]) throw new ConflictException('Default queue does not exist');
      this.assertScope(user, queue.rows[0].legal_entity, queue.rows[0].country);
      if (dto.regulatoryProfile) {
        const profile = await client.query('SELECT 1 FROM regulatory_profiles WHERE profile_key=$1 AND active=true AND jurisdiction=$2', [dto.regulatoryProfile, user.country]);
        if (!profile.rowCount) throw new ConflictException('Regulatory profile does not exist, is inactive, or belongs to another jurisdiction');
      }
      if (dto.workflowKey) {
        const workflow = await client.query('SELECT 1 FROM workflow_definitions WHERE workflow_key=$1 AND active=true', [dto.workflowKey]);
        if (!workflow.rowCount) throw new ConflictException('Workflow does not exist or is inactive');
      }
      const result = await client.query<{ category_key: string; default_queue: string; active: boolean }>(`INSERT INTO ticket_categories (category_key,default_queue,active,regulatory_profile,block_customer_communication,workflow_key,retention_years,updated_by)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6,'standard'),COALESCE($7,7),$8)
        ON CONFLICT (category_key) DO UPDATE SET default_queue=EXCLUDED.default_queue, active=EXCLUDED.active, regulatory_profile=EXCLUDED.regulatory_profile, block_customer_communication=EXCLUDED.block_customer_communication, workflow_key=EXCLUDED.workflow_key, retention_years=EXCLUDED.retention_years, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING category_key,default_queue,active`, [categoryKey, dto.defaultQueue, dto.active, dto.regulatoryProfile ?? null, dto.blockCustomerCommunication ?? false, dto.workflowKey ?? null, dto.retentionYears ?? null, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.category_updated', targetType: 'category', targetId: categoryKey, correlationId, outcome: 'success', metadata: { previous, defaultQueue: dto.defaultQueue, active: dto.active, regulatoryProfile: dto.regulatoryProfile ?? null, blockCustomerCommunication: dto.blockCustomerCommunication ?? false } });
      await this.outbox.enqueue(client, { eventType: 'configuration.category_changed', aggregateType: 'category', aggregateId: categoryKey, correlationId, payload: { category: categoryKey, defaultQueue: dto.defaultQueue, active: dto.active } });
      const row = result.rows[0];
      return { category: row.category_key, defaultQueue: row.default_queue, active: row.active };
    });
  }

  async upsertSlaPolicy(user: UserContext, policyKey: string, priority: string, dto: UpsertSlaPolicyDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(policyKey, 80);
    if (!['low', 'normal', 'high', 'critical'].includes(priority)) throw new ConflictException('SLA priority is invalid');
    return this.db.transaction(async (client) => {
      const previous = await this.audit.previous(client, 'sla_policies', 'policy_key=$1 AND priority=$2', [policyKey, priority]);
      const result = await client.query<{ policy_key: string; priority: string; first_response_minutes: number; resolution_minutes: number; active: boolean }>(`INSERT INTO sla_policies (policy_key,priority,first_response_minutes,resolution_minutes,active,calendar,pause_while_pending_customer,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (policy_key,priority) DO UPDATE SET first_response_minutes=EXCLUDED.first_response_minutes, resolution_minutes=EXCLUDED.resolution_minutes, active=EXCLUDED.active, calendar=EXCLUDED.calendar, pause_while_pending_customer=EXCLUDED.pause_while_pending_customer, updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING policy_key,priority,first_response_minutes,resolution_minutes,active`, [policyKey, priority, dto.firstResponseMinutes, dto.resolutionMinutes, dto.active, dto.calendar ?? 'wall', dto.pauseWhilePendingCustomer ?? false, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.sla_policy_updated', targetType: 'sla_policy', targetId: `${policyKey}:${priority}`, correlationId, outcome: 'success', metadata: { previous, firstResponseMinutes: dto.firstResponseMinutes, resolutionMinutes: dto.resolutionMinutes, active: dto.active, calendar: dto.calendar ?? 'wall', pauseWhilePendingCustomer: dto.pauseWhilePendingCustomer ?? false } });
      await this.outbox.enqueue(client, { eventType: 'configuration.sla_policy_changed', aggregateType: 'sla_policy', aggregateId: `${policyKey}:${priority}`, correlationId, payload: { policyKey, priority, firstResponseMinutes: dto.firstResponseMinutes, resolutionMinutes: dto.resolutionMinutes, active: dto.active } });
      const row = result.rows[0];
      return { policyKey: row.policy_key, priority: row.priority, firstResponseMinutes: row.first_response_minutes, resolutionMinutes: row.resolution_minutes, active: row.active };
    });
  }

  async upsertCommunicationTemplate(user: UserContext, templateKey: string, dto: UpsertCommunicationTemplateDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'configuration:write');
    this.assertKey(templateKey, 100);
    return this.db.transaction(async (client) => {
      const previous = await this.audit.previous(client, 'communication_templates', 'template_key=$1', [templateKey]);
      const result = await client.query<{ template_key: string; channel: string; active: boolean; requires_approval: boolean }>(`INSERT INTO communication_templates (template_key,channel,active,requires_approval,subject_template,body_template,updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (template_key) DO UPDATE SET channel=EXCLUDED.channel, active=EXCLUDED.active, requires_approval=EXCLUDED.requires_approval, subject_template=COALESCE(EXCLUDED.subject_template, communication_templates.subject_template), body_template=COALESCE(EXCLUDED.body_template, communication_templates.body_template), updated_by=EXCLUDED.updated_by, updated_at=now()
        RETURNING template_key,channel,active,requires_approval`, [templateKey, dto.channel, dto.active, dto.requiresApproval, dto.subjectTemplate ?? null, dto.bodyTemplate ?? null, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'configuration.communication_template_updated', targetType: 'communication_template', targetId: templateKey, correlationId, outcome: 'success', metadata: { previous, channel: dto.channel, active: dto.active, requiresApproval: dto.requiresApproval } });
      await this.outbox.enqueue(client, { eventType: 'configuration.communication_template_changed', aggregateType: 'communication_template', aggregateId: templateKey, correlationId, payload: { templateKey, channel: dto.channel, active: dto.active, requiresApproval: dto.requiresApproval } });
      const row = result.rows[0];
      return { templateKey: row.template_key, channel: row.channel, active: row.active, requiresApproval: row.requires_approval };
    }).then(async (result) => {
      await this.cache.delete(COMMUNICATION_TEMPLATES_CACHE_KEY);
      return result;
    });
  }

  private assertScope(user: UserContext, legalEntity: string, country: string): void {
    if (user.legalEntity !== legalEntity || user.country !== country) throw new ForbiddenException('Configuration scope is outside your legal entity or country');
  }

  private assertKey(value: string, max: number): void {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length < 2 || value.length > max) throw new ConflictException('Configuration key is invalid');
  }
}
