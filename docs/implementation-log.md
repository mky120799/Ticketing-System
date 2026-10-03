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
- Verified against a real PostgreSQL 18 instance (commit-only NOTIFY, per-subscriber filtering, and a live HTTP stream with 401/403 handling) by `apps/api/test/workflow.integration-spec.ts`. Not yet exercised in a browser.

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
- The dispatcher, retry and stale-release paths are verified against PostgreSQL; the Kafka publisher is written but has not been run against a broker.
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
- Verified against PostgreSQL 18 by `workflow.integration-spec.ts` (assignment, timer, escalation, idempotency, history, outbox events). Not yet exercised through the UI.

**Interview summary.** "I turned the SLA from a passive field into an active workflow. New tickets are auto-assigned using configurable rules and a least-loaded or round-robin strategy, serialized per queue with an advisory lock. A scheduler, safe to run on every instance via a Postgres advisory lock, recomputes SLA status and executes escalation rules as a system actor. Escalation is idempotent through a unique constraint on ticket and rule, each ticket is handled in its own transaction after a row lock and re-check, and every action is audited, put on the outbox and pushed live to authorized users. It's a deliberate in-app stand-in for the Camunda timers planned for the pilot."

**Resume bullets.**
- Built configurable ticket auto-assignment (least-loaded / round-robin, rule specificity matching, advisory-lock serialization) and an SLA timer with multi-level escalation for a bank case-management platform.
- Made escalation idempotent and multi-instance safe using unique constraints, row locks and Postgres advisory locks; every system action is audited and published through a transactional outbox.

---

## 4. Operator UI for what the API already did

**Problem.** Attachments, relationships, SLA, escalation, dashboards, audit and routing configuration all existed as APIs but could only be used with `curl`.

**What was added.** Components in `apps/web/src/components/`, wired into `app.tsx` behind role-aware tabs (Workspace, Dashboard for supervisors and auditors, Administration for administrators).

| Component | What it shows / does | Key design point |
|---|---|---|
| `SlaAndTimeline` | SLA chip (running / first response overdue / breached), due times, assignee, and a status timeline in which automatic actions are labelled (`Automatic (escalation)`) and escalations are highlighted | Needed one backend addition: ticket detail now returns `history` from `ticket_status_history`. Built on data that was already being written. |
| `Attachments` | List with malware state, upload, gated download | Upload goes **straight from the browser to object storage** via the presigned URL. The browser computes a SHA-256 of the bytes with Web Crypto and sends it with the size in the `complete` call, so the server never touches file bytes. Download is only offered when the scan status is `clean`. If storage is not configured the UI says so. |
| `Relationships` | Linked tickets as opaque short IDs (click to open) and a form to link | The API rejects self- and cross-entity links; the UI just surfaces the error. |
| `AuditTrail` (auditor only) | Hash-chained event list showing each event's hash and its predecessor's, plus JSON export | Viewing and exporting are separately audited by the API. The chain display makes tamper evidence visible. |
| `Dashboard` | Tiles (active, overdue, resolved, closed, on-time %), workload table by queue, ageing bars | Aggregates only. "On-time %" is `(active - overdue) / active`, a simple proxy until true SLA-compliance reporting exists. |
| `Admin` | Queue members, assignment rules and escalation rules (list, create, edit) with selects populated from the real queue and category configuration | Uses the endpoints from entry 3. Selecting "Edit" loads a rule into the form; saving is an upsert. |

**Behaviour for administrator-only users.** They have no ticket entitlements by design, so the app opens on Administration and does not fetch tickets or open the live stream (which would only produce permission errors). Roles are loaded first and the ticket and stream effects wait for them.

**Files.** `apps/web/src/components/{ticket-extras,dashboard,admin}.tsx`, additions to `api.ts` and `app.tsx`, styles in `styles.css`; backend: `history` in `tickets.service.ts` ticket detail.

**Known limits.**
- `app.tsx` is still one dense file for the original workspace; the new work is in separate components, but the original code should be split up in a later cleanup.
- No automated UI tests; everything was verified by type-check, lint and a production build only, not in a browser.
- Dashboard values refresh on demand (not live).
- The ticket list does not yet show SLA or escalation badges; only the detail pane does.
- Attachment upload needs a configured S3-compatible bucket. Without it only metadata is recorded.

**Interview summary.** "I built the operator-facing screens for the backend capabilities, role-aware so each user only sees what they can use. Attachments upload directly to object storage with a client-side SHA-256, so the API never handles file bytes. The status timeline labels automatic system actions such as escalations, and the audit view shows the hash chain so tamper evidence is visible. Administrator-only accounts are routed straight to the admin screen without trying to load tickets."

**Resume bullets.**
- Delivered role-based React screens for SLA/escalation timeline, direct-to-storage checksummed attachment upload, audit hash-chain viewer, scoped dashboard, and routing administration.

---

## 5. Intake channels (email / portal / mobile / phone / internal) and demo users

**Problem.** Tickets could only be created by a signed-in staff member. The brief requires intake from email, web portal, mobile app and internal teams. Real adapters need a mail service and a customer identity provider that don't exist yet, so this entry builds the *contract and the core path* the adapters will plug into, plus a simulator.

**Design.**

```text
Channel adapter (email poller, portal backend, mobile BFF, CTI)
   │  client-credentials token for service identity `intake-gateway`
   ▼
POST /v1/intake/{channel}   { messageId, senderReference, subject, body, category?, priority? }
   │  one transaction, advisory-locked per (channel, messageId):
   │   ledger lookup  → duplicate? return the original ticket (duplicate:true)
   │   channel config → default category/queue/branch/priority
   │   insert ticket (created_by 'intake:<channel>', source_channel, standard sensitivity)
   │   SLA window, opaque masked sender reference, audit, outbox, auto-assignment, live event
   ▼
Same lifecycle as a staff-created ticket
```

| Decision | Reason |
|---|---|
| New **`intake-gateway` service role**, permission `intake:create` only | An adapter must be able to create tickets and nothing else: no reads, no updates. It follows the existing scanner / reconciler / notification-provider pattern. |
| One **normalized message** contract for every channel | Adapters differ in protocol, not in what a ticket needs. All source-specific parsing stays in the adapter. |
| **Idempotency by source message ID**: ledger `intake_messages` with PK `(channel, message_id)`, a request hash and an advisory lock | Mail servers and webhooks redeliver. Redelivery returns the original ticket; the same ID with different content is a 409. The advisory lock closes the race between two simultaneous deliveries. |
| **`intake_channels` configuration** (admin-managed, entity-scoped) | Intake carries no user context, so defaults come from configuration: category, queue, a virtual branch such as `DIGITAL`, default priority. Queue, department, entity and country are derived from the queue. |
| A message may name a **category**, but never route outside the channel's legal entity and country | Prevents a crafted message from landing in another entity's queue. |
| Only an **opaque sender reference**, always `standard` sensitivity, plain text body | No raw account, card or national-ID data enters through a channel. Restricted data is added later by staff. The UI renders text only. |
| Tickets get **`source_channel`** and are created by `intake:<channel>` | Visible in the ticket detail and the audit trail, and available for reporting. |
| **Dev simulator** `npm run intake:simulate -- email "Subject" "Body"` | Gets a client-credentials token from the local Keycloak and posts a message, so "email arrives, ticket appears live" can be demonstrated without a mail server. |

**Visibility note.** Intake tickets sit on the channel's virtual branch. Ordinary branch agents can't see them (their branch differs); assigned case agents, and supervisors and auditors of the queue, can. This is deliberate and keeps digital-channel work out of branch views.

**Demo identities** (dev realm only; password `local-dev-only-change-me` for people; the intake client secret is `local-dev-only-intake-secret`):

| User | Role | Queues |
|---|---|---|
| local-branch-agent | branch-agent | customer-support, payments |
| local-case-agent, local-case-agent-2 | case-agent | customer-support, payments |
| local-supervisor | supervisor | all six |
| local-auditor | auditor | all six |
| local-admin | administrator | all six |

Re-import the realm to pick these up (remove the Keycloak container volume or recreate the container).

**Files.** `apps/api/src/intake/*`, `configuration/routing.service.ts` (`intake-channels` endpoints), migration `1710000016000_intake_channels.cjs`, `scripts/simulate-intake.mjs`, role additions in `auth/*`, `infra/keycloak/bank-case-dev-realm.json`, admin UI section "Intake channels".

**To try it.** Sign in as `local-admin`, open Administration, configure the `email` channel (category, queue, branch `DIGITAL`), add `local-case-agent`'s subject ID as a member of that queue plus an assignment rule, then run `npm run intake:simulate --workspace=@bank-case/api`. Signed in as `local-case-agent` or `local-supervisor` in another browser, the ticket appears live, already assigned.

**Known limits.**
- Stub by design: no mailbox polling, no portal or mobile customer authentication, no spam, loop or auto-reply protection.
- Attachments aren't accepted through intake yet.
- No rate limiting per adapter.
- A channel adapter is trusted to resolve the sender to an opaque reference; verifying the customer is out of scope here.
- Verified against PostgreSQL 18 (create, redelivery, content-conflict 409, no read access for the gateway, assignment, live push). The Keycloak client-credentials flow and the simulator script have not been run.

**Interview summary.** "I defined a single, idempotent intake contract that any channel adapter calls using a narrowly scoped service identity, so email, portal, mobile and phone all create tickets through one audited path. Idempotency comes from a source-message ledger with an advisory lock; routing defaults come from admin-managed channel configuration rather than a user session; and a message can't route outside its legal entity. A dev simulator and demo users let the whole flow run locally without external systems."

**Resume bullets.**
- Designed an idempotent multi-channel intake API (email, portal, mobile, phone) with least-privilege service identity, per-channel routing configuration and source-message de-duplication.

---

## 6. Platform hardening (security headers, rate limiting, request limits)

**What was added.** In `apps/api/src/main.ts`: `@fastify/helmet` with a deny-everything Content-Security-Policy (the API only returns JSON), HSTS for a year, `no-referrer` and `frame-ancestors 'none'`; `@fastify/rate-limit` (default 600 requests/minute per client, `RATE_LIMIT_PER_MINUTE`) with health probes and the SSE stream exempt; a 1 MiB body cap (`MAX_BODY_BYTES`); log redaction of the `Authorization` and `Cookie` headers; and `TRUST_PROXY=true` so rate limiting keys on the real client address when running behind the bank's gateway.

**Why.** Banks' penetration tests check these first, and they are cheap to get right. The defaults are conservative, and every one is an environment variable so a bank's gateway team can tune them without a rebuild.

**Limits.** Rate limiting is per instance (in-memory). A cluster-wide limit belongs at the bank's API gateway or needs a shared store; the app limit is a backstop, not the primary control.

---

## 7. SLA accuracy, root cause, and richer reporting

**Problem.** "First response" was only guessed, a resolved ticket could still display as breached, and there was no root-cause field, so reports couldn't say *why* things went wrong.

**What changed.**
- `first_responded_at` is set by the first customer-facing action: a customer-visible note, a communication that is queued (or becomes queued after approval), or a move to `pending_customer` or `resolved`.
- `resolved_at` is set on resolve and cleared on reopen. SLA status is derived by comparing *actual-or-now* against each deadline in one SQL expression (`NEXT_SLA_STATUS_SQL`), shared by the manual reconcile and the timer: `breached`, `first_response_overdue`, `met` (resolved in time) or `running`. A ticket that is answered late keeps its `first_response_overdue` label as a historical fact.
- Resolving requires a **root cause** from a controlled list (database check constraint plus DTO validation). It is stored on the ticket, included in the audit event, and cleared on reopen.
- The `first_response_overdue` escalation trigger now means "no customer response yet and the deadline has passed", instead of the earlier "work hasn't started" approximation.
- Dashboard additions (last 30 days, scoped): resolved-on-time %, first-response-on-time %, average first-response minutes, escalation count, root-cause distribution, tickets by source channel.

**Interview summary.** "I replaced a heuristic SLA with measured timestamps and a single SQL expression that both the manual and automatic paths use, so there is one definition of 'breached'. Root cause is mandatory at resolution, which makes the root-cause report trustworthy rather than optional data entry."

---

## 8. Regulatory clocks, complaints (ASIC RG 271) and case controls

**Problem.** For an Australian bank the system must treat complaints specially: acknowledge within one business day, final response within 30 days (21 for hardship), record the internal dispute resolution (IDR) outcome, track external dispute (AFCA) referrals, flag vulnerable customers and systemic issues, and produce a complaints register. Other markets have different rules, so none of this can be hard-coded.

**Design: jurisdiction rules are data, not code.**

```text
regulatory_profiles   key, label, jurisdiction, acknowledge_business_days, final_response_calendar_days, at_risk_days
business_holidays     country, date, name            (business-day maths uses Mon-Fri minus these)
ticket_categories     + regulatory_profile, + block_customer_communication
tickets               + is_complaint, regulatory_profile, acknowledge_due_at, final_response_due_at, regulatory_status,
                        idr_outcome, vulnerability_flag, systemic_issue, afca_status, afca_reference, communications_blocked
```

- **Starting the clock.** A category linked to a profile makes new tickets complaints automatically (staff-created and intake alike). Staff can also mark an existing ticket as a complaint; the clock then runs from the *original receipt time*, not from when someone noticed, which is what the regulation requires.
- **Business days** are computed in the bank's time zone (`BUSINESS_TIMEZONE`, default `Australia/Sydney`) skipping weekends and configured holidays (`compliance/business-calendar.ts`, unit-tested).
- **Regulatory status** (`on_track`, `at_risk`, `ack_overdue`, `final_response_overdue`, `met`) is recomputed by the same timer as the SLA, in bounded batches, one audit/outbox/live event per change. Priority: final-response breach, then missed acknowledgement, then at risk.
- **New escalation triggers**: `regulatory_ack_overdue`, `regulatory_at_risk`, `regulatory_breached`, so escalation paths can be configured per queue exactly like SLA ones.
- **Resolving a complaint** requires an IDR outcome (`upheld`, `partially_upheld`, `not_upheld`, `withdrawn`, `resolved_by_agreement`) as well as a root cause.
- **External dispute scheme tracking** (`POST /tickets/{id}/afca`): supervisor-only, complaints only, reference required once referred.
- **Vulnerability and systemic-issue flags** via the complaint endpoint, audited with a reason.
- **Communication block (tipping-off control).** Customer-visible notes and communications are refused (409) while `communications_blocked` is set. The `fraud-case` category defaults to blocked; a supervisor can set or lift it per case, with the reason kept in the audit trail only, never in outbox events, because it may describe a sensitive investigation.
- **Complaints register** (`GET /reports/complaints?from&to&format=csv|json`): classifications, dates, outcomes, root cause, flags only, no free text. CSV cells beginning with `= + - @` are neutralised against spreadsheet formula injection. Every export is audited.
- **Admin**: regulatory profiles and holidays (jurisdiction-scoped to the administrator's country), plus per-category profile and block settings.
- **UI**: a Complaint and compliance panel on the ticket, status chips, IDR outcome on resolve, dashboard complaint tiles with a register export, and admin screens for profiles and holidays.

**Files.** `apps/api/src/compliance/*`, migration `1710000018000_regulatory_complaints.cjs` (AU RG 271 profiles seeded as editable rows), changes in `tickets.service.ts`, `intake.service.ts`, `escalation.service.ts`, `workflow-scheduler.ts`, `configuration.*`, `dashboard.service.ts`, and `apps/web/src/components/compliance-panel.tsx`, `admin.tsx`, `dashboard.tsx`.

**Selling to other banks.** A New Zealand or UK bank changes rows in `regulatory_profiles` and `business_holidays`, not code. Only the labels in the UI that say "AFCA" or "RG 271" would be re-worded; the AFCA fields are an "external dispute scheme" abstraction.

**Known limits.**
- The business day is calendar-based; it doesn't model cut-off times (for example "received after 5 pm counts as next day").
- Acknowledgement is currently "any first customer response". It does not yet check that a specific acknowledgement template was used.
- A complaint resolved with `pending_customer` stops no clock. Some regimes allow pausing; the profile model has no pause rule yet.
- Hardship-vs-standard profile selection is manual or by category; there is no automatic detection.
- The register is a reporting extract, not a filed regulatory return. The bank should confirm exact data points with its compliance team.
- Verified against PostgreSQL 18 (clock start, overdue detection, IDR outcome rule, AFCA validation, flags, communication block, CSV export). Not reviewed by a compliance specialist.

**Interview summary.** "Jurisdiction-specific regulation is modelled as configuration. A regulatory profile defines acknowledgement and final-response clocks; a category links to it; the same timer that drives SLAs recomputes regulatory status; and escalation, reporting and the UI all consume that status. Moving to another country is a data change. I also added a communication block so fraud investigations can't accidentally tip off a customer, and a register export hardened against CSV formula injection."

**Resume bullets.**
- Modelled regulatory complaint handling (ASIC RG 271) as data-driven profiles with business-day clocks, IDR outcomes, external-scheme tracking and an audited complaints register, making the product jurisdiction-portable.
- Implemented tipping-off controls and CSV-injection-safe exports for a regulated banking case system.

---

## 9. Data-driven workflow definitions

**Problem.** The ticket lifecycle was a hard-coded allow-list in `tickets.service.ts`, and "only a supervisor can cancel" was a separate hard-coded check. Each bank has its own process, so changing a flow meant changing code. There was also no workflow engine (see the architecture discussion about Camunda).

**What changed.**
- Tables `workflow_definitions` and `workflow_transitions` (with an optional `allowed_roles` list per transition). Each category points at a workflow (`ticket_categories.workflow_key`, default `standard`). The migration seeds `standard` with exactly the previous behaviour, including supervisor-only cancellation.
- `WorkflowDefinitionService.assertTransition()` replaces the hard-coded checks. The ticket detail now returns `allowedNextStatuses` for the caller, so the UI offers only legal moves.
- Admin API `GET/PUT /configuration/workflows`. A PUT replaces a workflow atomically and is **validated for safety**: a ticket must be able to leave `submitted`, no self-transitions, a terminal status must exist, and every status must be able to reach `closed` or `cancelled`, so a misconfigured flow cannot trap tickets. It is audited and emitted to the outbox.
- Admin UI section to view and edit workflow JSON.

**Relationship to Camunda.** Status changes still happen only through the API, and each emits an event. A BPMN engine therefore integrates in two ways without changing this design: it consumes `ticket.*` events from the bus, and it issues commands back through the same transition API. A bank that runs Camunda can model its process there; one that doesn't still has a configurable lifecycle. This is why the product does not depend on a particular engine.

**Known limits.** Only the status graph and role restrictions are configurable. Guards such as "needs approval before resolve", timers per state, and parallel branches are not yet expressible; those would be the case for adding an engine adapter. The JSON editor is deliberately simple; a graphical editor would be a later improvement.

**Interview summary.** "I moved the lifecycle out of code into validated configuration, so each category can have its own flow and role restrictions, and the API tells the UI which transitions are legal. I added reachability checks so an administrator can't save a workflow that traps tickets. Because transitions go through one audited API and emit events, a BPMN engine can integrate later without redesign."

**Resume bullets.**
- Replaced a hard-coded case lifecycle with validated, per-category workflow definitions (role-gated transitions, reachability checks), keeping the system engine-agnostic for later BPMN integration.

---

## 10. Retention enforcement (de-identification)

**Problem.** Retention dates and legal holds could be *recorded* but nothing acted on them. Australian Privacy Principle 11.2 requires personal information to be destroyed or de-identified when no longer needed, and a bank must also be able to prove holds were respected.

**Design.**
- Effective retention date = a supervisor-set date when present, otherwise `closed_at + category.retention_years` (default 7, configurable per category). `closed_at` is maintained by the status transition and cleared on reopen (migration `1710000020000`).
- `RetentionService` (run hourly by the scheduler, **opt-in** via `RETENTION_ENFORCEMENT_ENABLED=true` because it is destructive) selects closed/cancelled tickets past retention with no legal hold, in batches of 100.
- **De-identify, don't delete.** It overwrites subject, description, custom fields, note bodies, reference values, recipient references and attachment names, deletes the stored files, and stamps `redacted_at`. The ticket skeleton (IDs, category, dates, status, IDR outcome, root cause) stays for statistics, and the immutable audit trail stays intact. That is why free text is deliberately kept out of audit and outbox payloads.
- **Safe against races.** Files are deleted first (idempotent, so a failure just retries next run), then a transaction re-checks under a row lock that the ticket is still closed, unredacted and not under hold, because a supervisor may have placed a hold since the candidate query.
- A de-identified ticket is read-only: reopening, notes and communications are refused (409).
- Each redaction is audited as `system:retention` and emitted as `ticket.redacted`.

**Known limits.** The audit trail may still contain short reasons typed by staff (for example a complaint classification reason); keep those operational and free of personal data. Subject-access (APP 12) export is not built. Backups hold pre-redaction data until they expire; the bank's backup retention must align with this policy.

**Interview summary.** "Retention is enforced, not just recorded: an opt-in job de-identifies expired tickets while keeping the skeleton and the immutable audit trail, re-checks legal hold under a row lock immediately before changing anything, and makes de-identified tickets read-only."

---

## 11. Observability: Prometheus metrics

**What.** `GET /v1/metrics` in Prometheus format: Node process metrics, HTTP request counts and latency by *route pattern* (never raw URLs or IDs), outbox rows by status (so a growing `dead_letter` count can alert), open tickets by SLA status, and connected live streams.

**Security.** The endpoint is **disabled (404) unless `METRICS_TOKEN` is set**, then requires a bearer token compared in constant time. Labels carry no customer data. It is exempt from the rate limit so scrapes never fail.

**Not included.** Distributed tracing: OpenTelemetry's Node auto-instrumentation can be attached at start-up (`--require @opentelemetry/auto-instrumentations-node/register`) with the bank's collector endpoint, without code changes. Log shipping uses the structured JSON logs already emitted, with credentials redacted.

---

## 12. Packaging and delivery: containers, Helm, CI security gates

**Goal.** One build that deploys to any bank, runs as a locked-down workload, and is continuously scanned.

**Decisions and what testing found.**
- **One image per app, configured at runtime.** The web bundle used build-time `VITE_*` variables, which would force a rebuild per bank. It now reads `/config.js`, generated by a start-up script from `API_URL`, `OIDC_AUTHORITY`, `OIDC_CLIENT_ID` (values JSON-escaped). The nginx CSP `connect-src` is also an environment variable.
- **Locked-down containers.** API runs as uid 1000 and web as uid 101, both on a read-only root filesystem with all capabilities dropped. Building and running them under those constraints exposed real issues, fixed in the code: the AWS SDK lives in the workspace's own `node_modules` (not copied at first), nginx needs writable `conf.d`/cache/tmp volumes with the right owner, and nginx drops inherited `add_header` values inside a `location`, so the security headers moved to one include used by every location.
- **Helm chart** (`deploy/helm/bank-case`): secrets are only *referenced* (`existingSecret`), never created; rolling updates with `maxUnavailable: 0`, HPA, PodDisruptionBudget, zone spread, probes, default-deny NetworkPolicies with explicit allows, ingress tuned for SSE, and a pre-upgrade **migration job** (a failed migration blocks the rollout). Linted and rendered with Helm 3.16; not installed on a live cluster.
- **`scripts/migrate.mjs`** locates the migration tool wherever npm put it, so the job command does not depend on the `node_modules` layout.
- **Dependency finding.** `npm audit` reported two high-severity issues via the migration tool's `glob`. Upgrading `node-pg-migrate` to v9 cleared them, and all 20 migrations were re-run from an empty database to prove compatibility. CI now fails on high/critical findings.
- **CI.** The main workflow also builds the web app, lints and renders the chart, and builds both images. A separate security workflow runs on every change and weekly: dependency audit, CodeQL (security-extended), Trivy image scans plus SBOM generation, and secret scanning.
- **Real defects found only by running the stack:** CORS allowed GET/HEAD/POST only (every PUT from the browser would have failed in the dev setup); the dev realm's `queues` claim was typed as JSON so Keycloak could not issue tokens; dev users lacked an email so Keycloak 26 treated them as not fully set up. All fixed.

**Interview summary.** "I treated delivery as part of the product: a single runtime-configurable image per app that runs as non-root on a read-only filesystem, a Helm chart that references secrets rather than owning them and runs migrations as a gating hook, and CI that blocks on vulnerable dependencies and scans images and code. Actually running the containers against real Keycloak surfaced three bugs that unit tests would never have caught."

**Resume bullets.**
- Packaged a regulated-industry platform as hardened, runtime-configurable containers with a Helm chart (HPA, PDB, NetworkPolicies, migration hooks) and CI gates for CodeQL, dependency audit, Trivy and SBOM generation.

---

## 13. Subject-access export (Privacy Act APP 12)

`POST /v1/privacy/subject-access { reference }` returns what the platform holds for an opaque customer reference within the caller's scope. It is supervisor-only, scoped to the supervisor's entity/country/queues, and audited without recording the reference. Customer-visible content (subject, description, customer notes, communication metadata) is released; internal notes are only counted, and cases with communications blocked (for example investigations) or already de-identified are *withheld* and counted, because releasing them needs a human privacy decision. The response says so explicitly. Identity verification of the requester is the bank's process and happens before this call.

---

## 14. Audit trail completion: verification, anchoring, search, list-view auditing

**Problem.** The trail was append-only and hash-chained but nothing *proved* it, the event time was not part of the hash, a database owner could rewrite or truncate it unnoticed, auditors could only look one ticket at a time, and list/search views were not audited.

**What changed.**

| Gap | Fix | Why this design |
|---|---|---|
| Timestamps not protected | New events use **hash version 2**: a canonical JSON (keys sorted recursively) of id, timestamp, actor, action, target, outcome, metadata and the previous hash. The timestamp is set by the application and stored with millisecond precision so recomputation matches exactly. | Sorted keys make the hash independent of JSON key order. Existing events keep `hash_version = 1` because their original metadata key order cannot be recovered from `jsonb`, so they are link-checked only and counted as "legacy". |
| Nothing proved integrity | `AuditIntegrityService.verify()` walks the chain, checks each link, recomputes every v2 hash, and checks every published anchor. Results go to `audit_verifications`. | Incremental runs (hourly) resume from the last clean checkpoint and are cheap. **Testing exposed that incremental runs cannot see changes to history already verified**, so a **full** re-walk exists too (daily with the anchor job, or `POST /audit/verify?full=true`). |
| Tail truncation undetectable | Daily **anchors**: the verified chain head is published outside the database as an outbox event (to the bank's bus/SIEM) and, if object storage is configured, as a JSON object (use a bucket with Object Lock). Every verification run checks that each anchor still matches its event. | Deleting the newest events leaves a perfectly linked chain; only a copy the database owner cannot rewrite reveals it. Verified: a test deletes the anchored event and later ones and the next run fails with an anchor mismatch. |
| One ticket at a time | `GET /audit/events` (auditor) filters by actor, action prefix, outcome and time with a cursor. It is limited to events about tickets in the auditor's entity, country and queues and excludes restricted-sensitivity tickets, mirroring ticket access. The search itself is audited. | Reuses the existing scoping rules, so the audit view never exposes more than the ticket view would. |
| List/search not audited | One audit event per list or search request with the result count and the first 50 opaque ticket IDs (`AUDIT_LIST_VIEWS=false` turns it off). | One event per request, not per ticket, keeps volume sane while still answering "who could see which tickets". |
| No alerting | Metrics `audit_chain_valid`, `audit_chain_verified_sequence`, `audit_chain_last_verified_timestamp_seconds`. | A failing verification should page someone; alert on `audit_chain_valid == 0` and on a stale timestamp. |

**UI.** An Audit tab for auditors shows verification status (or a prominent integrity failure), the last anchor, buttons for incremental and full verification, and the search with paging.

**Tests (one targeted test, because this is the control a bank will probe).** Verified against PostgreSQL: a changed timestamp is detected at the exact event; a deleted middle event breaks the chain; truncating the tail including an anchored event is detected only through the anchor; restoring the data returns the status to valid; search is scoped, filterable, auditor-only and audited; list views are audited.

**Known limits.**
- v1 events can't be fully re-verified (link only). New events are fully verifiable. Run the system for a while and the legacy share shrinks in relative terms; it never disappears.
- A truncation of events *after* the last anchor, within the anchor interval (default 24 h), is undetectable until the next anchor. Shorten the interval, or stream audit events to the SIEM continuously, to narrow that window.
- The verifier and the data share a database. An attacker who controls both the database and the application could rewrite history and recompute hashes; the external anchors are the defence, so they must go somewhere the database administrators cannot alter.
- Audit writes still take one global lock, which serialises them across the system.
- Staff-typed reasons in metadata are immutable once written and cannot be de-identified.

**Interview summary.** "I made the audit trail provable rather than merely append-only. Events carry a canonical hash that includes their timestamp; a verifier recomputes the chain hourly and fully each day; and the chain head is published outside the database so even deleting the newest events is detected. Writing the test caught a flaw in my own design: incremental verification can't see changes to history it has already checked, so I added a full re-verification mode."

**Resume bullets.**
- Built a tamper-evident audit trail with canonical versioned hashing, scheduled verification, externally published anchors (outbox/object storage), Prometheus alerting metrics and a scoped auditor search; proved detection of timestamp edits, mid-chain deletion and tail truncation with integration tests.
