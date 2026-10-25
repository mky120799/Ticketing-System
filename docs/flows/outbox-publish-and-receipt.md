# Flow: transactional outbox publication and receipt

1. Domain service changes business rows and calls `OutboxService.enqueue(client,event)` with the same transaction client.
2. Commit makes both state and pending outbox row visible; rollback removes both.
3. Each dispatcher periodically releases stale in-flight rows and claims up to 25 due records in a short `FOR UPDATE SKIP LOCKED` transaction.
4. Claim marks rows in-flight, timestamped and attempt-incremented.
5. Outside the claim transaction, publisher sends an envelope with stable event id, aggregate key and correlation id.
6. Success marks published. Failure schedules exponential retry; fifth failure dead-letters.
7. A downstream system deduplicates by event id and optionally posts a receipt.
8. Integration receipt locks published outbox row, inserts one receipt per event/external system, audits it and returns exact replays idempotently.

## Crash windows

- Before business commit: no business row or event.
- After commit, before claim: pending row remains.
- After claim, before publish: stale release retries.
- After broker accepted, before `markPublished`: duplicate publish occurs. Consumers must deduplicate.
- Permanent provider/config fault: dead letter; audited Operations replay after correction.

Kafka keys messages by aggregate id for per-aggregate partition ordering and includes event/correlation headers. Ordering across different aggregates is not guaranteed or required.

## Interview answer

> I solve database/broker dual write by inserting the event in the business transaction. Dispatchers use skip-locked claims, publish outside database locks and retry/dead-letter failures. The unavoidable crash window can duplicate but not lose a committed event, so every envelope has a stable event id and consumers/receipts are idempotent.
