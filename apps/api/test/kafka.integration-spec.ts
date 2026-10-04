import { Kafka } from 'kafkajs';
import { KafkaOutboxPublisher } from '../src/outbox/outbox-publishers.js';

const brokers = process.env.KAFKA_TEST_BROKERS;
const describeIfBroker = brokers ? describe : describe.skip;

describeIfBroker('Kafka outbox publisher', () => {
  it('delivers an event keyed by aggregate with its envelope and headers', async () => {
    const prefix = `it-${Date.now()}`; const topic = `${prefix}.ticket`; const publisher = new KafkaOutboxPublisher(brokers!.split(','), prefix, 'integration-test');
    const kafka = new Kafka({ clientId: 'it-consumer', brokers: brokers!.split(',') });
    const admin = kafka.admin(); await admin.connect(); await admin.createTopics({ topics: [{ topic, numPartitions: 1 }] }); await admin.disconnect();
    const consumer = kafka.consumer({ groupId: `${prefix}-group` }); await consumer.connect(); await consumer.subscribe({ topic, fromBeginning: true });
    const received = new Promise<{ key: string; value: Record<string, unknown>; headers: Record<string, string> }>((resolve) => { void consumer.run({ eachMessage: async ({ message }) => resolve({ key: message.key!.toString(), value: JSON.parse(message.value!.toString()), headers: Object.fromEntries(Object.entries(message.headers ?? {}).map(([k, v]) => [k, String(v)])) }) }); });
    await publisher.publish({ id: 'evt-1', eventType: 'ticket.created', aggregateType: 'ticket', aggregateId: 'ticket-42', correlationId: 'corr-1', payload: { ticketId: 'ticket-42' }, attempts: 1, createdAt: new Date('2026-01-02T03:04:05Z') });
    const message = await Promise.race([received, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no message within 20s')), 20_000))]);
    expect(message.key).toBe('ticket-42'); expect(message.value).toMatchObject({ eventId: 'evt-1', eventType: 'ticket.created', occurredAt: '2026-01-02T03:04:05.000Z', payload: { ticketId: 'ticket-42' } });
    expect(message.headers).toMatchObject({ 'event-id': 'evt-1', 'event-type': 'ticket.created', 'correlation-id': 'corr-1' });
    await consumer.disconnect(); await publisher.close();
  }, 40_000);
});
