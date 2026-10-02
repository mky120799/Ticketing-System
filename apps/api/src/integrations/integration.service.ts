import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PgService } from '../database/pg.service.js';
import { PolicyService } from '../auth/policy.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { UserContext } from '../auth/user-context.js';
import type { IntegrationReceiptDto } from './integration-receipt.dto.js';
import type { CommunicationDeliveryReceiptDto } from './communication-receipt.dto.js';

@Injectable()
export class IntegrationService {
  constructor(private readonly db: PgService, private readonly policy: PolicyService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async recordReceipt(user: UserContext, eventId: string, dto: IntegrationReceiptDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'integration:reconcile');
    return this.db.transaction(async (client) => {
      const event = await client.query<{ id: string; event_type: string; aggregate_type: string; aggregate_id: string; status: string }>('SELECT id,event_type,aggregate_type,aggregate_id,status FROM integration_outbox WHERE id=$1 FOR UPDATE', [eventId]);
      if (!event.rows[0]) throw new NotFoundException('Outbox event not found');
      if (event.rows[0].status !== 'published') throw new ConflictException('Only published events can be reconciled');
      const existing = await client.query<{ id: string; external_reference: string; outcome: string; payload_hash: string | null; observed_at: Date }>('SELECT id,external_reference,outcome,payload_hash,observed_at FROM integration_receipts WHERE outbox_event_id=$1 AND external_system=$2', [eventId, dto.externalSystem]);
      if (existing.rows[0]) {
        const receipt = existing.rows[0];
        if (receipt.external_reference !== dto.externalReference || receipt.outcome !== dto.outcome || (receipt.payload_hash ?? null) !== (dto.payloadHash?.toLowerCase() ?? null)) throw new ConflictException('A different receipt already exists for this event and system');
        return { id: receipt.id, eventId, externalSystem: dto.externalSystem, externalReference: receipt.external_reference, outcome: receipt.outcome, payloadHash: receipt.payload_hash, observedAt: receipt.observed_at, replayed: true };
      }
      const id = randomUUID();
      await client.query('INSERT INTO integration_receipts (id,outbox_event_id,external_system,external_reference,outcome,payload_hash,received_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, eventId, dto.externalSystem, dto.externalReference, dto.outcome, dto.payloadHash?.toLowerCase() ?? null, user.subject]);
      await this.audit.write(client, { actorId: user.subject, action: 'integration.receipt_recorded', targetType: 'outbox_event', targetId: eventId, correlationId, outcome: 'success', metadata: { externalSystem: dto.externalSystem, receiptOutcome: dto.outcome, eventType: event.rows[0].event_type } });
      return { id, eventId, externalSystem: dto.externalSystem, externalReference: dto.externalReference, outcome: dto.outcome, payloadHash: dto.payloadHash?.toLowerCase() ?? null, replayed: false };
    });
  }

  async recordCommunicationReceipt(user: UserContext, communicationId: string, dto: CommunicationDeliveryReceiptDto, correlationId: string): Promise<unknown> {
    this.policy.assertPermission(user, 'communication:deliver');
    if (dto.status !== 'failed' && dto.failureCode) throw new ConflictException('Failure code is only valid for failed delivery');
    if (dto.status === 'failed' && !dto.failureCode) throw new ConflictException('Failed delivery requires a provider failure code');
    return this.db.transaction(async (client) => {
      const communication = await client.query<{ id: string; ticket_id: string; status: string }>('SELECT id,ticket_id,status FROM ticket_communications WHERE id=$1 FOR UPDATE', [communicationId]);
      if (!communication.rows[0]) throw new NotFoundException('Communication not found');
      const current = communication.rows[0].status;
      if (current === 'pending_approval' || current === 'rejected') throw new ConflictException('Communication is not eligible for provider delivery');
      const existing = await client.query<{ id: string; provider: string; provider_message_id: string; status: string; failure_code: string | null; occurred_at: Date }>('SELECT id,provider,provider_message_id,status,failure_code,occurred_at FROM communication_delivery_receipts WHERE communication_id=$1 AND provider=$2 AND provider_message_id=$3 AND status=$4', [communicationId, dto.provider, dto.providerMessageId, dto.status]);
      if (existing.rows[0]) {
        const receipt = existing.rows[0];
        if ((receipt.failure_code ?? null) !== (dto.failureCode ?? null)) throw new ConflictException('A different failure code already exists for this provider receipt');
        return { id: receipt.id, communicationId, provider: receipt.provider, providerMessageId: receipt.provider_message_id, status: receipt.status, failureCode: receipt.failure_code, occurredAt: receipt.occurred_at, replayed: true };
      }
      this.assertDeliveryTransition(current, dto.status);
      const id = randomUUID();
      const receipt = await client.query<{ occurred_at: Date }>('INSERT INTO communication_delivery_receipts (id,communication_id,provider,provider_message_id,status,failure_code,received_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING occurred_at', [id, communicationId, dto.provider, dto.providerMessageId, dto.status, dto.failureCode ?? null, user.subject]);
      if (this.deliveryRank(dto.status) > this.deliveryRank(current)) await client.query('UPDATE ticket_communications SET status=$1,updated_at=now() WHERE id=$2', [dto.status, communicationId]);
      await this.audit.write(client, { actorId: user.subject, action: 'customer_communication.delivery_receipt_recorded', targetType: 'communication', targetId: communicationId, correlationId, outcome: 'success', metadata: { ticketId: communication.rows[0].ticket_id, provider: dto.provider, status: dto.status } });
      await this.outbox.enqueue(client, { eventType: 'customer_communication.delivery_updated', aggregateType: 'communication', aggregateId: communicationId, correlationId, payload: { communicationId, ticketId: communication.rows[0].ticket_id, status: dto.status, provider: dto.provider } });
      return { id, communicationId, provider: dto.provider, providerMessageId: dto.providerMessageId, status: dto.status, failureCode: dto.failureCode ?? null, occurredAt: receipt.rows[0].occurred_at, replayed: false };
    });
  }

  private assertDeliveryTransition(current: string, next: 'sent' | 'delivered' | 'failed'): void {
    if (current === 'delivered' && next !== 'delivered') throw new ConflictException('Delivered communication cannot move backwards');
    if (current === 'failed' && next !== 'failed') throw new ConflictException('Failed communication cannot move backwards');
    if (current !== 'queued' && current !== 'sent' && current !== 'delivered' && current !== 'failed') throw new ConflictException('Communication is not in a deliverable state');
  }

  private deliveryRank(status: string): number { return status === 'delivered' || status === 'failed' ? 2 : status === 'sent' ? 1 : 0; }
}
