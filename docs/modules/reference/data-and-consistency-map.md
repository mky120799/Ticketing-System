# Data and consistency map

[Reference index](README.md) · [Runtime wiring](runtime-wiring-map.md) · [Failure and test map](failure-and-test-map.md)

This map separates four concepts that are often confused in interviews:

```text
transaction atomicity  = which PostgreSQL writes commit/roll back together
concurrency control    = what happens when operations overlap
idempotency            = what a retry with the same logical identity does
delivery semantics     = what can happen across PostgreSQL/network/provider boundaries
```

## Module/subsystem matrix

| Area | Principal durable state | Consistency mechanism | Retry/delivery behavior |
|---|---|---|---|
| Authentication | no local token session row; optional remote introspection/entitlement caches in memory | cryptographic verification then normalized context | each request reverified; cache TTL bounds revocation/entitlement freshness |
| Directory | `staff_directory` | subject-keyed upsert; entity/country-scoped reads | record failure is fail-open for name decoration; next `/me` retries |
| Tickets create | `tickets`, references, SLA/compliance rows, history, idempotency, audit/outbox | one DB transaction; durable idempotency key/hash; creation-time assignment inside transaction | same key/same body replays original; same key/different hash conflicts; current concurrent first-use race should be integration-tested/hardened |
| Ticket update/status | `tickets`, status history, notes, related rows | service transaction and optional expected timestamp check | API returns 409 for already-stale browser; current read/check/update is not atomic under two simultaneous writers |
| Assignment | `tickets`, `queue_members`, history, notifications | queue advisory lock for automatic selection; ticket transaction | automatic path is serialized; manual path currently does not validate active target-queue membership |
| SLA/compliance | due timestamps/statuses, holidays/hours/profiles | business-time calculation plus bounded scheduler reconciliation | repeated reconcile should converge; scheduler lock selects one tick |
| Workflow definitions | `workflow_definitions`, `workflow_transitions` | validation then transactional replacement/upsert | runtime transition reloads active definition; bad graph/config is rejected |
| Escalation | `ticket_escalations`, ticket/history/evidence | per-ticket `FOR UPDATE`; unique `(ticket_id, rule_key)` claim | repeated scheduler scans do not apply same rule twice |
| Retention | ticket content tables plus object-store files | candidate scan then external delete then locked DB recheck/redaction | object delete is idempotent; current delete-before-locked-hold-recheck has a cross-store race |
| Attachments | `attachments`, object bytes | intent/completion/scan state transitions; size/hash; service policy | presigned upload may be retried; scan selection currently lacks durable claim and can duplicate external work |
| Secure upload links | `upload_links`, communication/ticket/attachment state | signed narrow token plus DB state/expiry/revocation/usage checks | invalid capability returns uniform refusal; no reusable storage credential |
| Communications | `ticket_communications`, approvals, receipts | create/approval transaction; maker-checker lock; worker claim/lease; monotonic receipt rank | provider call can duplicate after crash; stable ids/provider idempotency and receipt dedupe required |
| Notifications | `notifications`, `notification_reads` | created in producer transaction; audience evaluated at read; per-user `ON CONFLICT DO NOTHING` read marker | live event is only a hint; stale notification does not grant ticket access |
| Intake | `intake_messages`, ticket/reference/history/evidence | durable `(channel, messageId, payload hash)` idempotency and one transaction | exact retry returns original; key with changed payload conflicts |
| Portal | tickets/notes/attachments through service-owned tables | customer subject-derived ownership on every operation | guessed UUID gets safe not-found; portal creation uses durable idempotency |
| Inbound email | mailbox state plus intake/ticket rows | bounded unread fetch; ownership reference; intake idempotency | message marked seen only after success; failure remains for retry |
| Outbound email | communication lease/state + provider receipt | worker leases queued rows and records Integration receipt | at least once around provider acceptance; status progression cannot move backward |
| Outbox | `integration_outbox` | enqueue in business transaction; `FOR UPDATE SKIP LOCKED` claim; stale lease; conditional status update | at least once; publish-before-mark can duplicate; retry/backoff then dead letter |
| Integration receipts | `integration_receipts`, `communication_delivery_receipts` | target row lock and unique logical receipt keys | exact retry returns stored result; contradictory retry is 409 |
| Audit events | `audit_events` | caller's business transaction; advisory lock serializes chain head; append-only DB role/trigger | successful evidence is atomic with mutation; denied 403 evidence is separate best-effort transaction |
| Audit integrity | verifications, anchors, chain bases, optional object anchor | sequence/link/hash recomputation, signature and anchor checks | incremental hourly plus full/daily behavior; external object failure reduces but does not erase DB anchor evidence |
| Live events | PostgreSQL `NOTIFY` plus in-memory subscribers | notify called inside transaction and emitted only on commit; subscriber policy filter | ephemeral; reconnect emits `resync`; browser refetches source of truth |
| Cache | Redis values | namespaced/scope-aware keys and TTL; database remains authority | fail-open optimization; miss/outage queries source of truth |
| Dashboard | aggregate reads from scoped tickets/SLA/compliance | policy-derived SQL predicates; no mutable client aggregate | refetch/cache; summary may be point-in-time and is not a transaction over future changes |
| Operations replay | outbox dead letters, audit | conditional dead-letter update; batch `SKIP LOCKED`; same transaction audit | replay means retry eligibility, not external completion |
| Scheduled reports | object-store CSV + audit | per-scope bounded query and independent file writes | one scope/file failure is logged and other scopes continue; scheduler retries later |
| Metrics | Prometheus process state plus scrape-time DB gauges | controlled route/status labels; no business mutation | scrape is observational; endpoint failure must not affect product writes |

## Transaction boundary patterns

### Pattern A: business state plus evidence/outbox

```ts
return db.transaction(async (client) => {
  const subject = await loadCurrentState(client);
  policy.assert(...);
  const changed = await mutate(client);
  await audit.write(client, event);
  await outbox.enqueue(client, message);
  await live.notify(client, kind, changed);
  return changed;
});
```

Guarantee: database state, audit row and pending event appear together. `pg_notify` is delivered after commit. It does not guarantee that Kafka/email/storage succeeds in the same transaction.

Review every call: a pool-level `db.query` inside the callback is not automatically part of the callback's `PoolClient` transaction.

### Pattern B: claim, commit, external work, mark

```text
short DB transaction: claim due rows and commit lease
-> external network/storage/provider work
-> short DB transaction: mark success or retry/dead-letter
```

This avoids holding locks during slow I/O. The trade-off is a crash window after external success and before marking; idempotency handles duplicate attempts.

### Pattern C: read-only scope predicate

List/search/dashboard/report queries encode the current actor's entity/country/queue/role scope in SQL, rather than loading broad data and filtering in JavaScript. This reduces accidental data exposure and memory use. A single-record service may load then apply `PolicyService` to provide consistent decisions/hiding.

## Concurrency mechanisms in the repository

| Mechanism | Used for | What it does not solve |
|---|---|---|
| PostgreSQL transaction | atomic related DB writes | external broker/storage atomicity |
| row `FOR UPDATE` | approval/receipt/escalation/current-state serialization | callers that do not take the same lock |
| `FOR UPDATE SKIP LOCKED` | outbox/admin batch claims | exactly-once external effects |
| advisory transaction lock | audit chain head, scheduler tick, queue assignment | long/network work should not hold it indefinitely |
| unique constraint | idempotency/receipt/escalation logical key | semantic equivalence unless request hash is also compared |
| expected timestamp | stale browser detection | simultaneous read/check/update without lock/conditional WHERE |
| persisted lease timestamp | worker crash recovery | duplicate external success after mark crash |
| process boolean/timer | local overlap prevention | coordination among replicas |

## Known hardening items

### Ticket optimistic concurrency

Most ticket mutation helpers load without `FOR UPDATE` and compare `expectedUpdatedAt` before an unconditional update. Use a conditional update/version column or lock before checking to guarantee one winner.

### Attachment scan claim

The worker selects pending rows without changing them to an owned in-progress lease. Add a claim status/owner/timestamp with stale recovery or run a single scanner instance.

### Manual assignee validation

The UI picker is filtered, but the assignment service must also verify the submitted subject is an active member of the target queue inside the transaction.

### Retention cross-store ordering

Object deletion currently precedes the final locked legal-hold recheck. Introduce a durable `redaction_pending` claim that legal-hold changes coordinate with, then perform idempotent deletes and finalize.

### First-use idempotency races

Whenever code performs “look up key, then insert,” verify how a simultaneous first use maps the unique violation. The desired contract is typically one success plus one replay, not one success plus an opaque 500.

## How to explain consistency without overclaiming

Use this sentence structure:

> Within PostgreSQL, X, audit and the pending outbox row commit atomically through the same `PoolClient`. Delivery outside PostgreSQL is at least once: a worker claims durably, retries failures and may repeat after a publish-before-mark crash, so downstream uses event/operation idempotency. The remaining race is …, which I would harden with … and prove using two synchronized database clients.

That answer distinguishes implemented guarantees, cross-system semantics and known improvement in one coherent path.
