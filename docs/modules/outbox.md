# Outbox module

The Outbox module solves the database/message-broker dual-write problem. A business transaction inserts its domain change and an `integration_outbox` row together; a separate dispatcher publishes committed rows at least once.

## Wiring and event contract

[`OutboxModule`](../../apps/api/src/outbox/outbox.module.ts) is global. It provides `OutboxService`, `OutboxDispatcher` and the `OUTBOX_PUBLISHER` factory, exporting `OutboxService` to domain modules.

`OutboxService.enqueue(client, event)` requires the caller's `PoolClient`. That API design makes it difficult to accidentally enqueue outside the business transaction. Each event has a UUID, event type, aggregate type/id, correlation id, bounded JSON payload and creation time.

[`toEnvelope`](../../apps/api/src/outbox/outbox-publishers.ts) produces the external contract:

```ts
{
  eventId, eventType, aggregateType, aggregateId,
  correlationId, occurredAt, payload
}
```

Consumers must use `eventId` as their idempotency key because delivery is at least once.

## Claim and publish flow

[`OutboxService.processBatch`](../../apps/api/src/outbox/outbox.service.ts) first claims 1–100 rows in a short transaction. `claim` selects due `pending`/`retry` rows ordered by creation, uses `FOR UPDATE SKIP LOCKED`, marks them `in_flight`, sets `claimed_at` and increments attempts. Multiple dispatchers can therefore drain the table without selecting the same available row.

Publishing occurs outside the claim transaction so a slow broker does not hold database row locks. Success marks the row `published`. Failure stores a non-sensitive error category and schedules exponential retry (`1, 2, 4...` seconds, capped at one hour); the fifth failed attempt becomes `dead_letter`.

If a process crashes after claim, `releaseStale` moves old `in_flight` rows back to retry. If it crashes after broker success but before `markPublished`, the event is sent again—why downstream deduplication is mandatory.

## Dispatcher and publishers

[`OutboxDispatcher`](../../apps/api/src/outbox/outbox-dispatcher.ts) is opt-in with `OUTBOX_DISPATCHER_ENABLED=true`. It releases stale claims periodically, processes batches of 25 and immediately loops when a full batch indicates backlog. Shutdown clears its timer and closes the publisher.

Local development uses `LogOutboxPublisher`, which logs metadata only. `KafkaOutboxPublisher` uses aggregate id as the message key to preserve per-aggregate partition order, includes event/correlation headers and enables the KafkaJS idempotent producer. Configuration selects publisher, brokers and topic prefix.

## Frontend and operations

The browser never consumes outbox rows as authorization. Live events or polling make it refetch API state. Administrators use the Operations endpoints/admin integration section to inspect backlog, retries and dead letters and to replay eligible records with an audited command.

## Tests and interview answer

Test rollback (no orphan event), competing dispatchers, batch bounds, publisher failure, exponential retry, dead-letter threshold, stale release and duplicate consumer delivery. Kafka coverage is in [`kafka.integration-spec.ts`](../../apps/api/test/kafka.integration-spec.ts).

> I used the transactional outbox pattern: domain code inserts the event using the same PostgreSQL client as the ticket change. A background dispatcher claims rows with `FOR UPDATE SKIP LOCKED`, publishes outside the lock transaction and marks success or retry. A crash can cause duplicate publication, never a lost committed event, so the envelope carries a stable event id and consumers deduplicate it.
