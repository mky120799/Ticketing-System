# Lesson 7 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Crash-window exercise

For the outbox, predict recovery:

| Crash point | Durable state | Recovery |
|---|---|---|
| before claim commit | pending/retry | another worker can claim |
| after claim, before publish | in-flight | stale release moves to retry |
| after publish, before mark | in-flight but event delivered | stale release republishes; consumer deduplicates by event id |
| after mark published | published | not selected again |

This table is the practical meaning of at-least-once delivery.

## 2. Find the bug: `setInterval`

```ts
onModuleInit() {
  setInterval(() => void this.processBatch(), 1000);
}
```

Problems: a slow pass overlaps the next one, timer handle is not retained/cleared, tests start side effects, errors may become unhandled, and the process may not exit. Use a guarded self-rescheduling timeout plus cleanup and a separate `runOnce`.

## 3. Find the bug: process-local lock

```ts
if (this.running) return;
this.running = true;
await work();
this.running = false;
```

This can prevent overlap in one instance (with `finally` added), but five replicas each have their own boolean. Use a database claim/advisory lock/queue lease for cross-instance coordination.

## 4. Design a safe claim

For a scan worker, propose columns:

```text
scan_status: pending | in_scan | complete | retry
claimed_at
claim_owner
attempts
next_attempt_at
last_error_code
```

Claim a bounded batch using `FOR UPDATE SKIP LOCKED`, commit, perform external scanning, then conditionally mark by row id/status/owner. Release stale claims. Keep checksum and final state transitions idempotent.

## 5. Interview answer at three depths

### 30 seconds

> Nest lifecycle hooks start and stop opt-in workers. Each loop uses a self-rescheduling timeout so passes do not overlap locally, exposes one bounded pass for testing, and clears timers/clients on shutdown. Multi-instance safety comes from PostgreSQL claims or advisory locks, not from Nest singleton providers.

### Two minutes

> The outbox dispatcher starts in `onModuleInit` only when enabled, drains batches of 25 and schedules immediately while busy or sleeps otherwise. It claims rows using `FOR UPDATE SKIP LOCKED`, publishes outside the claim transaction, marks success, retries with backoff, dead-letters after five attempts and releases stale in-flight leases. Because a crash can happen after publish but before mark, consumers deduplicate by event id. The workflow scheduler uses `pg_try_advisory_xact_lock` so one replica runs a tick. Shutdown sets a stopped flag, clears timers and closes the publisher. The attachment scanner is bounded and state-safe but currently lacks a durable claim, so I would call out duplicate external scan work as a hardening item.

### Code-level follow-up

Sketch:

```ts
private schedule(delay: number) {
  if (this.stopped) return;
  this.timer = setTimeout(() => void this.tick(), delay);
  this.timer.unref();
}

private async tick() {
  try { await this.runOnce(); }
  catch (error) { this.logger.error(safeMessage(error)); }
  finally { this.schedule(this.pollMs); }
}
```

Then explain the separate database mechanism needed for several replicas.

## 6. Common follow-ups

1. **Why `setTimeout` instead of `setInterval`?** Schedule after completion to avoid local overlap.
2. **Why publish outside the claim transaction?** Avoid holding locks/connections during network I/O.
3. **Can this guarantee exactly-once Kafka delivery?** No; cross-system crash windows remain. Use at-least-once plus idempotent consumers.
4. **What does `SKIP LOCKED` do?** Competing workers skip rows another transaction locked, enabling disjoint batches.
5. **Why stale leases?** A process can die after claiming; durable timeout recovery makes work available again.
6. **Why call a service from a worker?** Reuse policy/state/audit invariants independent of HTTP.
7. **How do you test concurrency?** Real database, at least two clients/workers, synchronized starts, and assertions that claims do not overlap.

## 7. Hands-on exercise

Design a notification delivery worker. Include:

- enabling configuration and startup failure policy;
- one bounded `runOnce`;
- database claim SQL;
- lease timeout;
- idempotency key at provider boundary;
- retry/backoff/dead-letter state;
- shutdown behavior;
- metrics and alert thresholds;
- unit and PostgreSQL concurrency tests.

## 8. Self-assessment

You are ready when you can enumerate crash windows, distinguish local timer safety from distributed coordination, and state delivery semantics without claiming impossible exactly-once guarantees.
