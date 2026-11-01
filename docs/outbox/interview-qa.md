# Outbox interview Q&A

[Back to Outbox index](README.md)

---

## 30 seconds
> I use the transactional outbox. Business code inserts the event with the same transaction client as the change, so they commit or roll back together. Dispatchers on every instance claim due rows with `FOR UPDATE SKIP LOCKED`, publish outside the lock, then mark them published, or retry with exponential backoff and dead-letter after five attempts. A crash after publishing can duplicate but never lose an event, so envelopes carry a stable event ID and consumers de-duplicate. Kafka keys by aggregate for per-ticket order.

## 2 minutes
> `OutboxService.enqueue` requires a `PoolClient`, which makes it hard to enqueue outside a transaction. Payloads are flat, minimised IDs. The dispatcher, opt-in and safe everywhere, releases stale in-flight rows every minute, then claims 25 rows in a CTE with `SKIP LOCKED` that sets in-flight, the claimed time and the attempt count. It publishes each through an injected publisher (log locally, Kafka in production: topic per aggregate type, key = aggregate ID, event and correlation IDs as headers, idempotent producer). Success marks published; failure schedules 2^(n-1) seconds of backoff, and the fifth failure dead-letters. Administrators can replay dead letters through an audited endpoint. Consumers can post receipts that are idempotent per (event, system) and conflict on contradiction.

## Questions

**Q1. What problem does the outbox solve?**
> The dual write: committing to the DB and publishing to Kafka can't be atomic, so one can succeed without the other. Putting the event in the DB transaction makes the event's existence atomic with the change; publishing becomes a retryable background job.

**Q2. Why not just use Kafka transactions?**
> They make Kafka writes atomic with each other, not with PostgreSQL. You'd need a distributed transaction (2PC), which is fragile and slow.

**Q3. How do multiple dispatchers avoid sending the same row?**
> `FOR UPDATE SKIP LOCKED` in the claim: each gets different rows without waiting, and the claimed rows are marked in-flight before the transaction ends.

**Q4. Why publish outside the transaction?**
> So slow brokers don't hold row locks or connections. Claim fast, publish slow, mark fast.

**Q5. Where can duplicates happen?**
> If the broker accepted the message but we crashed before marking it published, the stale release republishes it after five minutes. Consumers de-duplicate by `eventId`.

**Q6. What does the idempotent Kafka producer give you, then?**
> It de-duplicates the producer's own network retries within a session. It doesn't cover our crash-and-republish case; `eventId` does.

**Q7. Is ordering guaranteed?**
> Per aggregate on the happy path, via the partition key. A retried event can arrive after a newer one, so consumers should compare `occurredAt` or re-read state. Events are notifications, not truth.

**Q8. What's in the payload?**
> IDs and classifications only, never customer content, so the bus doesn't become another personal-data store, and consumers needing details call the API with their own authorisation.

**Q9. How do you recover from a long outage?**
> Events pile up in retry and then dead-letter; nothing is lost. After the fix, an administrator replays one, verifies it, then replays the rest. The dispatcher drains backlogs quickly by looping immediately on full batches.

**Q10. How would you scale it?**
> Partition dispatch by aggregate hash, archive or partition published rows (the table grows), and add an index on `created_at` for the claim order. The current design already parallelises safely.

## Limitations
1. Published rows are never cleaned up, so you need a retention job or table partitioning.
2. `last_error` is a single category, with no detailed diagnostics.
3. There is no consumer-side library; consumers must implement de-duplication themselves.
