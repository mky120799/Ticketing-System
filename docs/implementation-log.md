# Implementation log

One entry per feature: what it does, how it was built, why it was built that way, and the trade-offs. Written to be explained in an interview. Entries are in the order they were built.

---

## 1. Live ticket updates (Server-Sent Events + PostgreSQL LISTEN/NOTIFY)

**Problem.** When one user changes a ticket (status, assignment, edit, note, new ticket), every other user who is *allowed to see it* should see the change without refreshing. In a bank, "everyone" must mean "everyone authorized for that ticket's branch, queue, entity, country and sensitivity".

**Architecture.**

```text
Browser A ── POST /v1/tickets/{id}/status ──▶ TicketsService.transition()
                                              │  one DB transaction:
                                              │   update ticket + status history + audit event
                                              │   + outbox row + pg_notify('ticket_live', ...)
                                              ▼  COMMIT  (NOTIFY is delivered only now)
                         every API instance holds one LISTEN connection
                                              ▼
                         LiveEventsService.dispatch(): for each connected subscriber,
                         run PolicyService.assertTicketAccess(user, ticketScope, 'ticket:read')
                                              ▼
Browser B, C ◀── SSE frame {type, ticketId, status, at} ── GET /v1/events/stream
        │
        └─ refetch GET /v1/tickets/{id} over REST (authorized, audited, masked) and patch the UI
```

**Key decisions and why.**

| Decision | Reason |
|---|---|
| Actions stay REST (`POST /status`); only notifications are pushed | Per-request auth, validation, idempotency and audit keep working. A status change is a rare discrete action, so it doesn't need a bidirectional socket. |
| SSE instead of WebSockets | Traffic is one-way (server to browser). SSE is plain HTTP so the gateway, WAF, CORS and token validation work unchanged, and browsers/`fetch` handle reconnection. |
| `pg_notify` inside the business transaction | PostgreSQL delivers NOTIFY only on COMMIT. A rolled-back change therefore cannot produce a live event, with no extra bookkeeping. It also needs no new infrastructure. |
| One LISTEN connection per API instance, in-memory fan-out | Multiple API pods stay consistent without Redis or Kafka. Redis stays a non-authoritative cache. |
| Authorization filter applied per subscriber, per event | Never broadcast to a shared channel and let the client filter. The notify message carries the ticket's *scope* (queue, branch, entity, country, sensitivity, creator, assignee); the server checks it with the same `PolicyService` as REST. |
| Payload is only `{type, ticketId, status, at}` | No customer data in the push channel. The client refetches through the normal audited endpoint, so masking and audit rules cannot be bypassed. |
| Reassignment also notifies the *previous* queue | Users who just lost access get the event, refetch, receive 403, and drop the ticket from their list. |
| `fetch` stream instead of `EventSource` | `EventSource` cannot send an `Authorization` header, which would force the JWT into the URL (logged by proxies). |
| Stream closes at JWT expiry (`exp` claim) | A long-lived connection must not outlive the token that authorized it. |
| `resync` frame after the LISTEN connection reconnects | NOTIFY has no replay. Anything missed during an outage is recovered by telling clients to refetch. Client reconnects also resync. |
| Max 5 streams per user, 25 s heartbeat | Bounds resource use and keeps proxies from closing idle connections. |

**Failure behaviour.** If the listener drops, it reconnects with exponential backoff (1 s up to 30 s) and sends `resync`. If the browser stream drops, it reconnects with backoff, shows "Offline" in the header, and resyncs on reconnect. If a subscriber write throws, that subscriber is removed. Live updates are a convenience: REST remains the source of truth, and nothing breaks if the feed is down.

**Files.**
- `apps/api/src/live/live-events.service.ts` – notify, LISTEN, fan-out, per-subscriber policy filter.
- `apps/api/src/live/live-events.controller.ts` – `GET /v1/events/stream` (raw SSE response, hijacked from Fastify, CORS headers preserved, heartbeat, expiry).
- `apps/api/src/live/live.module.ts` – global module.
- `apps/api/src/tickets/tickets.service.ts` – `live.notify(...)` in create, update, assign, transition and addNote.
- `apps/api/src/auth/auth.guard.ts`, `user-context.ts` – `tokenExpiresAt` from the JWT `exp`.
- `apps/web/src/api.ts` – `subscribeToLiveEvents` (fetch streaming, SSE parser, backoff, resync).
- `apps/web/src/app.tsx` – refetch-and-patch handler, removal on 403/404, "Live/Offline" indicator.

**Known limits (deliberate).**
- NOTIFY payloads are capped near 8 KB and are not durable; this is why payloads are tiny and clients resync.
- Fan-out cost is O(subscribers) per event per instance, fine for a pilot. At large scale, index subscribers by queue.
- Approval/communication state changes do not push yet; only ticket-level events do.
- Not yet verified against a running database in this environment (no Docker). Needs a manual run, then an integration test.

**Interview summary.** "I made ticket changes appear live for every authorized user. Actions stay as REST calls; notifications flow over Server-Sent Events. The API emits `pg_notify` inside the same transaction as the change, so Postgres only delivers it after commit. Each API instance listens and fans events out to its own SSE connections, re-running the same authorization policy per subscriber, so nobody receives events for tickets they can't read. Events carry only an opaque ID and status; the client refetches through the audited REST API, so masking and audit rules can't be bypassed. It handles reconnection, missed events with a resync signal, and token expiry."

**Resume bullets.**
- Built real-time ticket updates for a bank case-management platform using SSE and PostgreSQL LISTEN/NOTIFY, with commit-only delivery and no extra message broker.
- Enforced per-subscriber authorization (branch, queue, entity, sensitivity) on every pushed event; payloads carry no customer data, and clients refetch through audited REST endpoints.

---

## 2. Outbox dispatcher and pluggable publishers (log / Kafka)

**Problem.** Every business change already wrote a minimized event into `integration_outbox` in the same transaction (the transactional outbox pattern), and `OutboxService.processBatch()` could claim, retry and dead-letter rows. But nothing ever called it, so events were never delivered, and a crash after claiming left rows stuck in `in_flight` forever.

**What was added.**

```text
business txn ──▶ integration_outbox (pending)
                      │  OutboxDispatcher loop (every OUTBOX_POLL_MS, immediately again if a batch was full)
                      ▼
          claim 25 rows: FOR UPDATE SKIP LOCKED → in_flight, claimed_at=now()
                      ▼
          publisher.publish(event)  ──ok──▶ published
                      │ fail
                      ▼
          retry with backoff 1s,2s,4s… (max 1h) ──5th failure──▶ dead_letter
```

| Decision | Reason |
|---|---|
| In-process polling loop, self-scheduling `setTimeout`, not `setInterval` | A slow batch can never overlap with the next one, and a full batch re-runs at once so backlogs drain quickly. |
| `FOR UPDATE SKIP LOCKED` claiming (already present) | Every API instance can run the dispatcher; instances never publish the same row concurrently. |
| `claimed_at` column + `releaseStale()` (migration `1710000014000`) | If a process dies between claim and acknowledge, rows would stay `in_flight` forever. Rows older than `OUTBOX_STALE_SECONDS` (default 300) are returned to `retry`. |
| Delivery is at-least-once, so the envelope carries `eventId` | A crash after publish but before acknowledge causes a duplicate. Consumers de-duplicate on `eventId` (also sent as the Kafka `event-id` header). |
| `OutboxPublisher` chosen by `OUTBOX_PUBLISHER` (`log` default, `kafka`) | The domain code never knows the transport. The bank's approved bus becomes one more class. |
| Kafka messages keyed by `aggregateId`, topic `<prefix>.<aggregateType>`, idempotent producer | All events for one ticket stay ordered on one partition; producer retries don't duplicate within a session. |
| `kafkajs` loaded with dynamic `import()` | Environments using the log publisher never load or connect to Kafka. |
| Dispatcher is opt-in (`OUTBOX_DISPATCHER_ENABLED=true`) | Tests and scripts that call `processBatch` directly can't race a background loop. `.env.example` turns it on for local use. |
| Optional Redpanda container behind a compose profile | `docker compose --profile kafka up -d redpanda` gives a local Kafka-compatible broker without starting it by default. |

**Files.** `apps/api/src/outbox/outbox-dispatcher.ts` (loop), `outbox-publishers.ts` (envelope, log and Kafka publishers, factory), `outbox.service.ts` (`claimed_at`, `releaseStale`, `createdAt` on records), `outbox.module.ts`, migration `1710000014000_outbox_claim_tracking.cjs`, `docker-compose.yml`, `.env.example`.

**Known limits.**
- Polling adds up to `OUTBOX_POLL_MS` latency; live UI updates deliberately don't depend on it (see entry 1).
- Dead-lettered rows are not yet visible or replayable from any API or UI. That is a good next item (admin replay endpoint plus a dashboard counter).
- The Kafka publisher is written but has not been run against a broker in this environment.
- Ordering across retries isn't guaranteed: a retried event can arrive after a later event for the same ticket. Consumers should treat events as notifications and read current state, or compare `occurredAt`.

**Interview summary.** "Business changes write their integration events to an outbox table in the same transaction, so we never lose or invent an event. I added the background dispatcher that drains it: it claims batches with `SKIP LOCKED` so any number of instances can run it, retries with exponential backoff, dead-letters after five failures, and releases rows abandoned by a crashed process. Delivery is at-least-once with an event ID for de-duplication. The transport is pluggable; there's a log publisher for development and a Kafka publisher keyed by ticket so per-ticket order is preserved."

**Resume bullets.**
- Implemented a transactional-outbox dispatcher (SKIP LOCKED claiming, exponential backoff, dead-lettering, crash recovery) with a pluggable Kafka publisher giving at-least-once, per-aggregate-ordered delivery.

---

## 3. Assignment rules, SLA timer and automatic escalation

**Problem.** Tickets landed in a queue unassigned, SLA status only changed when a supervisor manually called the reconcile endpoint, and nothing happened when a ticket went overdue. The brief asks for configurable assignment rules, SLA timers and escalation paths.

**What was added.**

```text
Create ticket ─▶ AssignmentService.autoAssign()  (same transaction as the create)
                  rule match → strategy → pick a queue member → status 'assigned'

WorkflowScheduler (every WORKFLOW_TICK_MS, one instance wins an advisory lock)
   1. SlaService.reconcileSystem()   running → first_response_overdue → breached
   2. EscalationService.run()        for each active rule: overdue tickets in rule.queue
                                     ─▶ move to escalate_to_queue, status 'escalated',
                                        optional priority +1, unassign
```

Tables (migration `1710000015000`): `queue_members`, `assignment_rules`, `escalation_rules`, `ticket_escalations`.

**Assignment.**
- A rule matches on queue plus optional category and priority. The most specific active rule wins (category match, then priority match, then `sort_order`).
- Strategies: `least_loaded` (fewest open tickets, ties broken by who was assigned longest ago) and `round_robin` (longest since last assignment).
- Candidates come from `queue_members`, so no user-directory dependency: the administrator lists IdP subjects per queue.
- A per-queue transaction advisory lock (`pg_advisory_xact_lock(hashtext('assign:<queue>'))`) serializes decisions, so two tickets created at the same moment can't both pick the same "least loaded" person.
- No matching rule or no active member means the ticket stays unassigned, which is the old behaviour. Every auto-assignment writes status history, an audit event (`system:assignment-rules`) and an outbox event.

**SLA timer.** `reconcileSystem` is the existing reconcile logic without a user scope, run as `system:sla-timer`. It processes at most 500 tickets per tick with `FOR UPDATE SKIP LOCKED` so a tick never holds one huge transaction; the next tick continues. Each change is audited, emitted to the outbox, and pushed live (entry 1).

**Escalation.**
- Triggers: `first_response_overdue` (ticket still submitted/triage/assigned, so no work has started, and first-response deadline passed) and `breached` (resolution deadline passed on any open ticket).
- **Idempotency by constraint.** `ticket_escalations` has `UNIQUE (ticket_id, rule_key)`. The escalation claims its row with `INSERT ... ON CONFLICT DO NOTHING RETURNING`; only the winner proceeds. Repeated ticks and multiple instances therefore can't escalate a ticket twice.
- **Chaining.** Because uniqueness is per rule, a ticket can escalate again under a different rule (for example support to supervisor on first-response, supervisor to head office on breach).
- **Safe under concurrency.** Candidates are found cheaply, then each ticket is re-read `FOR UPDATE` in its own transaction and re-checked (a person may have moved or resolved it meanwhile). One transaction per ticket also keeps the global audit-chain lock short.
- The previous queue is passed to the live notifier, so users who just lost the ticket see it disappear.
- Rules are validated: both queues must be active and inside the administrator's legal entity and country, a queue cannot escalate to itself (also a DB check), and rules owned by another entity can't be edited.

**Cluster safety.** The scheduler wraps each tick in `pg_try_advisory_xact_lock`; instances that lose simply skip the tick. Opt-in with `WORKFLOW_SCHEDULER_ENABLED=true` (set in `.env.example`) so tests never race it.

**Administrator API** (all require the `administrator` role, audited, emitted via the outbox):

```text
PUT/GET  /v1/configuration/queues/{queue}/members[/{userId}]   body: {active}
PUT/GET  /v1/configuration/assignment-rules[/{ruleKey}]        body: {queue, category?, priority?, strategy, sortOrder, active}
PUT/GET  /v1/configuration/escalation-rules[/{ruleKey}]        body: {queue, trigger, escalateToQueue, raisePriority, active}
```

**Try it** (with an administrator token and Docker stack running):

```bash
curl -X PUT $API/v1/configuration/queues/customer-support/members/<agent-sub> -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"active":true}'
curl -X PUT $API/v1/configuration/assignment-rules/support-default -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"queue":"customer-support","strategy":"least_loaded","sortOrder":100,"active":true}'
curl -X PUT $API/v1/configuration/escalation-rules/support-first-response -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"queue":"customer-support","trigger":"first_response_overdue","escalateToQueue":"payments","raisePriority":true,"active":true}'
```

**Files.** `tickets/assignment.service.ts`, `tickets/sla.service.ts` (`reconcileSystem`), `workflow/escalation.service.ts`, `workflow/workflow-scheduler.ts`, `workflow/workflow.module.ts`, `configuration/routing.service.ts`, `routing.dto.ts`, `configuration.controller.ts`, migration `1710000015000_routing_and_escalation.cjs`.

**Known limits (deliberate).**
- "First response" is approximated by "work started" because the system doesn't yet record a first customer-facing response. A real first-response timestamp is a worthwhile follow-up.
- Raising priority does not recalculate SLA deadlines.
- No business-hours or holiday calendar; deadlines are wall-clock minutes. The bank's SLA calendar is an open decision (architecture section 11).
- Auto-assignment ignores shifts, absence and skills. Only active membership counts.
- No UI for rules or members yet (API only), and no seeded rules, because members must be real IdP subjects.
- The previous queue and escalated-from information is visible in status history, but the UI doesn't show an escalation badge yet.
- Not yet run against a database in this environment.

**Interview summary.** "I turned the SLA from a passive field into an active workflow. New tickets are auto-assigned using configurable rules and a least-loaded or round-robin strategy, serialized per queue with an advisory lock. A scheduler, safe to run on every instance via a Postgres advisory lock, recomputes SLA status and executes escalation rules as a system actor. Escalation is idempotent through a unique constraint on ticket and rule, each ticket is handled in its own transaction after a row lock and re-check, and every action is audited, put on the outbox and pushed live to authorized users. It's a deliberate in-app stand-in for the Camunda timers planned for the pilot."

**Resume bullets.**
- Built configurable ticket auto-assignment (least-loaded / round-robin, rule specificity matching, advisory-lock serialization) and an SLA timer with multi-level escalation for a bank case-management platform.
- Made escalation idempotent and multi-instance safe using unique constraints, row locks and Postgres advisory locks; every system action is audited and published through a transactional outbox.
