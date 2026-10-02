import { Logger } from '@nestjs/common';
import type { OutboxPublisher, OutboxRecord } from './outbox.service.js';

export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

/** The message every external consumer receives. `eventId` is the idempotency key: delivery is at-least-once. */
export function toEnvelope(event: OutboxRecord): Record<string, unknown> {
  return { eventId: event.id, eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId, correlationId: event.correlationId, occurredAt: event.createdAt.toISOString(), payload: event.payload };
}

/** Default publisher for local development: logs event metadata only (payloads are already minimized). */
export class LogOutboxPublisher implements OutboxPublisher {
  private readonly logger = new Logger('OutboxPublisher');
  async publish(event: OutboxRecord): Promise<void> { this.logger.log(`published ${event.eventType} aggregate=${event.aggregateId} event=${event.id}`); }
}

/**
 * Kafka publisher. Messages are keyed by aggregate ID so all events for one ticket stay ordered
 * on one partition; the event ID travels as a header for consumer-side de-duplication.
 */
export class KafkaOutboxPublisher implements OutboxPublisher {
  private producer: { connect(): Promise<void>; send(record: unknown): Promise<unknown>; disconnect(): Promise<void> } | null = null;
  private connecting: Promise<void> | null = null;
  constructor(private readonly brokers: string[], private readonly topicPrefix: string, private readonly clientId = 'bank-case-api') {}

  async publish(event: OutboxRecord): Promise<void> {
    await this.ready();
    await this.producer!.send({ topic: `${this.topicPrefix}.${event.aggregateType}`, messages: [{ key: event.aggregateId, value: JSON.stringify(toEnvelope(event)), headers: { 'event-id': event.id, 'event-type': event.eventType, 'correlation-id': event.correlationId } }] });
  }

  async close(): Promise<void> { await this.producer?.disconnect().catch(() => undefined); this.producer = null; this.connecting = null; }

  private async ready(): Promise<void> {
    this.connecting ??= (async () => {
      const { Kafka, logLevel } = await import('kafkajs');
      const producer = new Kafka({ clientId: this.clientId, brokers: this.brokers, logLevel: logLevel.WARN }).producer({ idempotent: true });
      await producer.connect();
      this.producer = producer;
    })().catch((error) => { this.connecting = null; throw error; });
    await this.connecting;
  }
}

export function createOutboxPublisher(): OutboxPublisher {
  if (process.env.OUTBOX_PUBLISHER === 'kafka') {
    const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').map((broker) => broker.trim()).filter(Boolean);
    if (!brokers.length) throw new Error('KAFKA_BROKERS must be set when OUTBOX_PUBLISHER=kafka');
    return new KafkaOutboxPublisher(brokers, process.env.KAFKA_TOPIC_PREFIX ?? 'bank-case');
  }
  return new LogOutboxPublisher();
}
