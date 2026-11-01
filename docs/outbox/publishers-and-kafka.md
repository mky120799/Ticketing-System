# Publishers and Kafka

[Back to Outbox index](README.md) · Code: [outbox-publishers.ts](../../apps/api/src/outbox/outbox-publishers.ts)

---

## 1. The publisher seam (custom provider)

```ts
export interface OutboxPublisher { publish(event: OutboxRecord): Promise<void>; }      // outbox.service.ts L8
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');                             // L4
// outbox.module.ts:
providers: [OutboxService, OutboxDispatcher, { provide: OUTBOX_PUBLISHER, useFactory: createOutboxPublisher }]
// dispatcher:
constructor(..., @Inject(OUTBOX_PUBLISHER) private readonly publisher: OutboxPublisher) {}
```

| Nest concept | Plain meaning |
|---|---|
| **Symbol injection token** | A unique name for "whatever implements publishing", since interfaces don't exist at runtime |
| **`useFactory`** | Decide at startup which implementation to build, based on env |
| **Why** | Swap Kafka for a log publisher locally, or a fake in tests, without touching the dispatcher |

[createOutboxPublisher, L44-L51](../../apps/api/src/outbox/outbox-publishers.ts#L44-L51): `OUTBOX_PUBLISHER=kafka` requires `KAFKA_BROKERS` (fails fast if empty); otherwise `LogOutboxPublisher`, which logs only type, aggregate and ID ([L12-L15](../../apps/api/src/outbox/outbox-publishers.ts#L12-L15)).

## 2. The envelope

[toEnvelope, L7-L9](../../apps/api/src/outbox/outbox-publishers.ts#L7-L9):

```json
{
  "eventId": "8b1d…",              
  "eventType": "ticket.status_changed",
  "aggregateType": "ticket",
  "aggregateId": "4f1c…",
  "correlationId": "c0ff…",
  "occurredAt": "2026-10-25T10:00:00.000Z",
  "payload": { "ticketId": "4f1c…", "fromStatus": "in_progress", "toStatus": "resolved" }
}
```

`eventId` = the outbox row ID = **the consumer's idempotency key**. `correlationId` links the event to the audit trail and logs of the request that caused it.

## 3. Kafka publisher

[KafkaOutboxPublisher, L21-L42](../../apps/api/src/outbox/outbox-publishers.ts#L21-L42):

```ts
await this.producer!.send({
  topic: `${this.topicPrefix}.${event.aggregateType}`,        // e.g. bank-case.ticket
  messages: [{ key: event.aggregateId,                         // partition key
               value: JSON.stringify(toEnvelope(event)),
               headers: { 'event-id': event.id, 'event-type': event.eventType, 'correlation-id': event.correlationId } }]
});
```

| Choice | Plain reason |
|---|---|
| Topic per aggregate type | Consumers subscribe to what they care about (`bank-case.ticket`, `bank-case.communication`) |
| **Key = aggregate ID** | Kafka sends all messages with the same key to the same partition, in order, so all events for one ticket stay ordered on the happy path |
| Headers | Consumers can route or de-duplicate without parsing the body |
| `producer({ idempotent: true })` ([L36](../../apps/api/src/outbox/outbox-publishers.ts#L36)) | Kafka itself de-duplicates **producer retries** within a session (no duplicate from a network retry inside one `send`). It does **not** remove outbox-level duplicates after a crash; `eventId` handles those |
| Lazy `import('kafkajs')` + connection reuse ([L33-L41](../../apps/api/src/outbox/outbox-publishers.ts#L33-L41)) | No Kafka dependency is loaded when unused; a failed connect resets so the next attempt retries |
| `close()` on shutdown | Clean disconnect |

## 4. Ordering: what is and isn't guaranteed

- **Per aggregate, on the happy path:** yes, thanks to the key and partition.
- **Across aggregates:** no, and not needed.
- **After a retry:** an older failed event can arrive **after** a newer one. The catalogue says so explicitly: consumers should compare `occurredAt` or re-read current state ([event-catalogue.md](event-catalogue.md)).

**Plain:** events are *notifications* ("ticket 4f1c changed"), not the source of truth. A consumer that needs details calls the API with its own authorisation.

## 5. Kafka test

[kafka.integration-spec.ts#L8](../../apps/api/test/kafka.integration-spec.ts#L8): with `KAFKA_TEST_BROKERS=localhost:19092`, publish an event and consume it, asserting topic, key = aggregate ID, the envelope fields and the headers.

## 6. Configuration

| Env var | Default | Meaning |
|---|---|---|
| `OUTBOX_DISPATCHER_ENABLED` | off | Run the loop |
| `OUTBOX_PUBLISHER` | `log` | `kafka` to publish |
| `KAFKA_BROKERS` | n/a | Comma-separated |
| `KAFKA_TOPIC_PREFIX` | `bank-case` | Topic = prefix.aggregateType |
| `OUTBOX_POLL_MS` | 2000 | Idle poll interval |
| `OUTBOX_STALE_SECONDS` | 300 | In-flight timeout |

Next: [Receipts and operations](receipts-and-operations.md)
