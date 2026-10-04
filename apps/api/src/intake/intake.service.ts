import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService } from '../auth/policy.service.js';
import type { UserContext } from '../auth/user-context.js';
import { PgService } from '../database/pg.service.js';
import { LiveEventsService } from '../live/live-events.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { AssignmentService } from '../tickets/assignment.service.js';
import { SlaService } from '../tickets/sla.service.js';
import type { IntakeChannel, IntakeMessageDto } from './intake.dto.js';

interface ChannelRow { default_category: string; default_queue: string; branch_code: string; default_priority: string; }
interface QueueRow { department: string; legal_entity: string; country: string; active: boolean; }

/**
 * Creates tickets for messages that arrive through a channel adapter (email, portal, mobile, phone, internal).
 * Adapters authenticate as the `intake-gateway` service identity and send one normalized message.
 * Intake tickets are standard sensitivity, carry only an opaque sender reference, and enter the same
 * SLA, assignment, audit, outbox and live-update path as staff-created tickets.
 */
@Injectable()
export class IntakeService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly sla: SlaService, private readonly assignment: AssignmentService, private readonly live: LiveEventsService, private readonly compliance: ComplianceService) {}

  async create(user: UserContext, channel: IntakeChannel, dto: IntakeMessageDto, correlationId: string): Promise<{ ticketId: string; status: string; duplicate: boolean }> {
    this.policy.assertPermission(user, 'intake:create');
    const requestHash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    return this.db.transaction(async (client) => {
      // Serialize concurrent deliveries of the same source message, then check the ledger.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`intake:${channel}:${dto.messageId}`]);
      const seen = (await client.query<{ request_hash: string; ticket_id: string; status: string }>('SELECT m.request_hash,m.ticket_id,t.status FROM intake_messages m JOIN tickets t ON t.id=m.ticket_id WHERE m.channel=$1 AND m.message_id=$2', [channel, dto.messageId])).rows[0];
      if (seen) {
        if (seen.request_hash !== requestHash) throw new ConflictException('Message ID was already used with different content');
        return { ticketId: seen.ticket_id, status: seen.status, duplicate: true };
      }
      const config = (await client.query<ChannelRow>('SELECT default_category,default_queue,branch_code,default_priority FROM intake_channels WHERE channel_key=$1 AND active=true', [channel])).rows[0];
      if (!config) throw new NotFoundException(`Intake channel ${channel} is not configured or is inactive`);
      const base = (await client.query<QueueRow>('SELECT department,legal_entity,country,active FROM case_queues WHERE queue_key=$1', [config.default_queue])).rows[0];
      let category = config.default_category; let queue = config.default_queue; let queueRow = base;
      if (dto.category && dto.category !== category) {
        const chosen = (await client.query<{ default_queue: string }>('SELECT default_queue FROM ticket_categories WHERE category_key=$1 AND active=true', [dto.category])).rows[0];
        if (!chosen) throw new ConflictException('Category does not exist or is inactive');
        const chosenQueue = (await client.query<QueueRow>('SELECT department,legal_entity,country,active FROM case_queues WHERE queue_key=$1', [chosen.default_queue])).rows[0];
        // A message may be categorized, but never routed outside the channel's legal entity and country.
        if (!chosenQueue?.active || chosenQueue.legal_entity !== base.legal_entity || chosenQueue.country !== base.country) throw new ConflictException('Category routes outside this channel\'s legal entity or country');
        category = dto.category; queue = chosen.default_queue; queueRow = chosenQueue;
      }
      if (!queueRow?.active) throw new ConflictException('Target queue is inactive');
      const priority = dto.priority ?? config.default_priority;
      const id = randomUUID(); const actor = `intake:${channel}`;
      const window = await this.sla.calculate(client, priority, new Date(), queueRow.country);
      await client.query(`INSERT INTO tickets (id,category,priority,sensitivity,queue,branch_code,department,legal_entity,country,subject,description,created_by,source_channel,sla_policy_key,first_response_due_at,resolution_due_at,sla_status)
        VALUES ($1,$2,$3,'standard',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'running')`, [id, category, priority, queue, config.branch_code, queueRow.department, queueRow.legal_entity, queueRow.country, dto.subject, dto.body, actor, channel, window.policyKey, window.firstResponseDueAt, window.resolutionDueAt]);
      await client.query('INSERT INTO ticket_references (id,ticket_id,reference_type,source_system,opaque_reference,masked_value) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'customer', channel, dto.senderReference, this.mask(dto.senderReference)]);
      await client.query('INSERT INTO intake_messages (channel,message_id,request_hash,ticket_id) VALUES ($1,$2,$3,$4)', [channel, dto.messageId, requestHash, id]);
      await this.audit.write(client, { actorId: user.subject, action: 'ticket.created', targetType: 'ticket', targetId: id, correlationId, outcome: 'success', metadata: { channel, queue, sensitivity: 'standard' } });
      await this.outbox.enqueue(client, { eventType: 'ticket.created', aggregateType: 'ticket', aggregateId: id, correlationId, payload: { ticketId: id, queue, priority, sensitivity: 'standard', channel, slaPolicyKey: window.policyKey, resolutionDueAt: window.resolutionDueAt.toISOString() } });
      await this.compliance.applyAtCreation(client, { id, category, country: queueRow.country, createdAt: new Date() }, correlationId, user.subject);
      await this.assignment.autoAssign(client, { id, queue, category, priority, status: 'submitted' }, correlationId);
      const row = (await client.query<{ status: string } & Parameters<LiveEventsService['notify']>[2]>('SELECT * FROM tickets WHERE id=$1', [id])).rows[0];
      await this.live.notify(client, 'ticket.created', row);
      return { ticketId: id, status: row.status, duplicate: false };
    });
  }

  private mask(value: string): string { return value.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`; }
}
