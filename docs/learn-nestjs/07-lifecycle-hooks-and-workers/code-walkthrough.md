# Lesson 7 code walkthrough: worker lifecycle and concurrency

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This walkthrough compares the outbox dispatcher, workflow scheduler and attachment scanner. They all use Nest lifecycle hooks, but they provide different concurrency guarantees.

## 1. Construction is not startup

Nest first constructs providers with their dependencies. After a module's providers are resolved, it invokes `onModuleInit`. Workers use that hook to decide whether to start:

```ts
onModuleInit(): void {
  if (
    process.env.OUTBOX_DISPATCHER_ENABLED !== 'true' ||
    !process.env.DATABASE_URL
  ) return;

  this.schedule(0);
}
```

Why not start the timer in the constructor?

- dependencies may not be fully initialized;
- tests that merely compile a provider graph can unexpectedly start side effects;
- configuration gates are harder to reason about;
- constructor failures obscure DI errors;
- lifecycle cleanup has no explicit paired boundary.

`onModuleInit` should wire the loop. The business pass belongs in a separately callable method.

## 2. Self-rescheduling avoids local overlap

`OutboxDispatcher` uses `setTimeout` after each completed tick:

```ts
private async tick(): Promise<void> {
  let busy = false;
  try {
    const result = await this.outbox.processBatch(this.publisher, 25);
    busy = result.claimed === 25;
  } catch (error) {
    this.logger.error(/* safe message */);
  }
  this.schedule(busy ? 0 : pollMs);
}
```

The next timer is not scheduled until the awaited pass completes, so one provider instance does not overlap itself. A full batch causes an immediate next pass; a partial batch sleeps. This is simple adaptive polling.

`timer.unref()` permits a Node process with no other work to exit. It does not cancel the timer and does not replace shutdown cleanup.

## 3. Shutdown is a state transition

```ts
async onModuleDestroy(): Promise<void> {
  this.stopped = true;
  if (this.timer) clearTimeout(this.timer);
  await this.publisher.close?.();
}
```

Setting `stopped` matters even after `clearTimeout`: a tick may already be executing and otherwise schedule the next timer when it finishes. External clients such as a Kafka producer also need closing.

For hooks to run on process signals, the application/deployment must perform graceful Nest shutdown rather than hard-killing the process. Shutdown has a deadline; workers should use bounded network timeouts and be restart-safe even if cleanup cannot finish.

## 4. Outbox: claim, publish, mark

The outbox write happens in the originating business transaction. The worker later claims work in another short transaction:

```sql
WITH candidates AS (
  SELECT id
  FROM integration_outbox
  WHERE status IN ('pending', 'retry')
    AND next_attempt_at <= now()
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE integration_outbox AS o
SET status = 'in_flight', claimed_at = now(), attempts = attempts + 1
FROM candidates
WHERE o.id = candidates.id
RETURNING ...;
```

`SKIP LOCKED` lets several replicas take disjoint rows without waiting. The transaction commits the claim before network publication; holding database locks while calling Kafka would increase contention and couple transaction duration to network latency.

After claim:

```text
publish succeeds -> mark published
publish fails    -> retry with exponential delay
attempt >= 5     -> dead_letter
process crashes  -> stale in_flight lease later becomes retry
```

The crash window between publish and mark means the same event can be published again. This is at-least-once delivery. `event.id` is sent as the consumer idempotency key; “exactly once” is not claimed across PostgreSQL and Kafka.

## 5. Workflow scheduler: one tick across replicas

The scheduler wraps a tick in a transaction and requests:

```sql
SELECT pg_try_advisory_xact_lock(804232) AS ok
```

If another replica owns the transaction-level lock, this replica returns `null`. The lock is automatically released on commit/rollback/connection loss. One winner performs SLA reconciliation, regulatory deadlines, escalation and optional hourly/daily jobs.

Important nuance: the code calls services while the outer transaction is open, and those services may manage their own queries/transactions. The advisory lock still serializes the scheduler tick, but it is not automatically the transaction used by every nested service unless the same client is passed. Keep the lock-holding work bounded.

The process-local `lastRetentionRun`/`lastAuditVerify` timestamps are safe only because the advisory lock chooses one tick at a time. They are not durable schedules: after restart, a due operation can run immediately, and leadership can move between replicas.

## 6. Attachment scanner: repeat-safe state, but no claim lease

`AttachmentScanWorker.runOnce` selects up to ten pending rows, streams objects to ClamAV, verifies the computed SHA-256 against the declared checksum and calls the same ticket service method used by an external scanner identity.

Strengths:

- bounded batch;
- no local file persistence;
- dedicated least-privilege service identity;
- state transition and audit reused through `TicketsService`;
- checksum mismatch can never release the file;
- one row failure does not abort the whole pass.

Current limitation: the initial SELECT has no `FOR UPDATE SKIP LOCKED` claim/status lease. Two API replicas can select and externally scan the same pending attachment. The ticket service rejects a second completed transition, so duplicate state commitment is constrained, but duplicate storage reads/ClamAV work can still occur. A production hardening would add an `in_scan` lease with stale recovery or run exactly one scanner deployment.

## 7. Compare worker coordination

| Worker | Local no-overlap | Cross-instance coordination | Retry model |
|---|---|---|---|
| Outbox dispatcher | self-rescheduled timer | row claim with `SKIP LOCKED` | persisted retry/dead letter/stale lease |
| Workflow scheduler | self-rescheduled timer | advisory transaction lock | next tick; operations should be idempotent |
| Attachment scanner | self-rescheduled timer | no durable claim currently | pending row appears again; service state rejects duplicate completion |
| Email delivery | polling loop | delivery claim/lease in its service flow | retry/receipt state |
| Inbound email | polling loop/mailbox lock | mailbox/message idempotency | message remains unread on failure |

Never say “all workers are safe because Nest providers are singletons.” A singleton coordinates only one process.

## 8. Worker identity and service reuse

The attachment scanner creates a fixed `UserContext`:

```ts
const SCANNER: UserContext = {
  subject: 'system:attachment-scanner',
  roles: ['attachment-scanner'],
  serviceIdentity: true,
  // human scope fields empty
};
```

It calls `TicketsService.recordAttachmentScan`, whose policy grants only the scanner permission. Reusing the application service prevents a background path from bypassing workflow/audit rules. A worker should not call a controller; controllers are transport adapters.

## 9. Testable worker shape

Prefer:

```ts
onModuleInit() { this.schedule(...); }
async runOnce(): Promise<number> { /* one bounded deterministic pass */ }
onModuleDestroy() { /* stop and close */ }
```

Tests can call `runOnce` with fake storage/publisher/clock and no timers. For claim correctness, use a real PostgreSQL integration test with concurrent clients; a mock cannot prove row-lock behavior.

## 10. Operational signals

For each worker observe:

- enabled/disabled configuration at startup;
- last successful pass time and duration;
- rows/messages selected, claimed, succeeded, retried and dead-lettered;
- oldest pending age, not only queue length;
- stale leases released;
- dependency timeout/error counts;
- graceful shutdown timeout.

A worker that logs only exceptions can be silently stopped with no exception. Freshness/lag metrics detect absence of progress.
