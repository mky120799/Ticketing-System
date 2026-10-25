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

---

## 15. Kafka and object storage verified against real services (and what that found)

**Why.** Entries 2 and 4 described a Kafka publisher and an S3/malware-scan flow that had only been unit-reasoned. Docker was available, so both were run for real.

**Kafka.** Redpanda (Kafka-compatible) was added to `docker-compose.yml` (profiles `kafka`/`app`; internal listener `redpanda:29092`, host listener `localhost:19092` because 9092 was taken by another project). `test/kafka.integration-spec.ts` publishes an outbox record and consumes it, asserting the message key (aggregate ID, so per-ticket order holds on one partition), the JSON envelope (event ID, type, `occurredAt`, payload) and the `event-id`/`event-type`/`correlation-id` headers. The containerised API now runs with `OUTBOX_PUBLISHER=kafka`.

**Object storage and malware scanning.**
- Local stack: an S3-compatible store (SeaweedFS; MinIO's community images were no longer pullable) and ClamAV (the Debian image, because the default has no arm64 build).
- `AttachmentScanWorker` streams each uploaded object from storage straight to ClamAV over the INSTREAM protocol (never to local disk) and records the verdict through the same `attachment:scan` path an external scanner would use, so the state machine and audit are identical. A SHA-256 is computed during the stream; a mismatch with the uploader's declared checksum is recorded as a scan error and never released.
- `test/storage.integration-spec.ts` uploads through a real presigned URL, and proves: a clean file is released and downloadable, the EICAR test virus is marked malicious, a checksum mismatch becomes a scan error, and downloads stay blocked until a clean verdict.

**Real defects found only by running it.**
1. The AWS SDK v3 adds a default CRC32 checksum to presigned URLs, computed for an *empty* body, so every real browser upload failed with `BadDigest`. Fixed with `requestChecksumCalculation: 'WHEN_REQUIRED'`. This would have broken uploads on real AWS S3 as well.
2. Forcing `ServerSideEncryption` into every presigned URL is not portable. It is now sent only if `OBJECT_STORAGE_SERVER_SIDE_ENCRYPTION` is explicitly set; default bucket encryption is the preferred control.
3. Presigned URLs must be signed for an address the browser can reach, which in containers differs from the address the API uses. Added `OBJECT_STORAGE_PUBLIC_ENDPOINT`.
4. Added an opt-in `OBJECT_STORAGE_CREATE_BUCKET=true` for development only.

**Limits.** The stores used are development stand-ins; the bank's production store, KMS keys, Object Lock policy and scanner fleet are still to be provisioned (see `production-readiness.md`).

---

## 16. Notifications and email (in and out)

**Problem.** Customer communications were governed but never sent, and staff only had live screen updates: no alert when something was assigned to them, an approval was waiting, or a deadline was at risk.

### Staff notifications
- `notifications` table: a notification targets one person, or everyone holding a **role in a queue** (for example supervisors of the payments queue), scoped to legal entity and country. Read state is **per person** (`notification_reads`), so one supervisor reading does not clear it for another.
- Created in the same transaction as the causing event: ticket assigned (manual or automatic), approval needed, SLA or regulatory risk (first response overdue, resolution breached, complaint not acknowledged, approaching or past final response), escalation (new queue's supervisors and the previous assignee), and customer replied.
- Notifications hold a title and a ticket ID only. Opening one loads the ticket through the normal authorized, audited path, so the inbox cannot leak case content.
- Delivered live: after commit a content-free push tells the matching connected users to refresh, over the existing `LISTEN/NOTIFY` channel, filtered per subscriber.
- UI: bell with unread badge and a dropdown inbox; clicking opens the ticket.

### Outbound email and SMS
- Template **subjects and bodies** now live in `communication_templates`, with only two placeholders (`{{ticketRef}}`, `{{status}}`), so a template can never pull other data from a case. Status is shown in customer-friendly words, never internal workflow states.
- `DeliveryWorker` picks up due `queued` messages, takes a short lease (`FOR UPDATE SKIP LOCKED` plus a pushed-out `next_attempt_at`) so several instances never double-send, renders, sends via SMTP (or an HTTP SMS gateway), and records the result through the **existing delivery-receipt state machine** (`sent`, or `failed` after five backoff attempts). Messages carry `Auto-Submitted: auto-generated` and the case reference in the subject. Blocked cases are never sent (the message is failed with `COMMUNICATION_BLOCKED`).
- **Contact resolution is a seam.** The platform does not keep customer contact data. `ContactResolver` calls a bank-controlled lookup (`CRM_CONTACT_URL`, returning `{email, mobile}`) for an opaque reference; for development, `ALLOW_DIRECT_ADDRESS_REFERENCES=true` treats the reference as the address. References of the form `mailto:` (created by inbound email for the address a customer wrote from) always resolve.

### Inbound email
- `InboundEmailWorker` reads unread mail over IMAP and creates tickets through the same intake path as every other channel.
- **Loop and abuse protection:** automatic mail (`Auto-Submitted`, `Precedence: bulk/junk/list`, `List-Id`, delivery reports, no-reply and mailer-daemon senders, our own address) is ignored; each sender is limited per hour (`EMAIL_MAX_TICKETS_PER_SENDER_HOUR`).
- **Privacy:** the sender is stored as a keyed pseudonym (`HMAC-SHA256`, key in `EMAIL_REFERENCE_SECRET`), not as an address. The address is held only in the reply reference needed to answer them, inside the protected boundary that retention later redacts.
- **Threading:** a reply quoting `[CASE-XXXXXXXX]` is attached to that ticket **only if the sender is the person who raised it** (matched by pseudonym); anyone else's message becomes their own ticket. Quoted history is cut, and customer replies move `pending_customer` tickets back to `in_progress` when the workflow allows it. Replies do not count as a staff response, so they cannot stop an SLA clock.
- **Acknowledgement:** a new email ticket automatically queues the standard acknowledgement (counted as the first response, which also satisfies "acknowledge within one business day"), unless communications are blocked.
- Attachments are not imported; the ticket records how many were dropped.

### Verified
`test/email.integration-spec.ts` against a real mail server (GreenMail): email becomes a ticket with a pseudonymous sender, the acknowledgement is delivered to the customer's mailbox with the case reference, a reply is threaded with quoted history removed, an impostor quoting the reference gets a separate ticket, auto-replies, bounces, bulk mail and our own address create nothing, and a flooding sender is capped. The workflow integration spec covers who receives which notification and per-person read state.

### Known limits
- Delivery receipts beyond `sent` (delivered, bounced) need provider support; plain SMTP only proves hand-off. Bounce handling currently just ignores bounces.
- No staff email or push, and no per-user preferences or quiet hours.
- No template editor UI; templates are edited through the configuration API/database.
- SMS needs the bank's gateway and the CRM lookup needs the bank's endpoint; both are interfaces here.

**Interview summary.** "Notifications reuse the transaction and event machinery already in place: they're written with the change that caused them and pushed after commit, with no content in the push. For email I built a delivery worker with leasing and backoff that reports through the same receipt state machine an external provider would use, a contact-resolver seam so the platform never stores customer addresses, and an inbound worker with loop protection, rate limits, pseudonymous senders and sender-verified reply threading. All of it was tested against a real mail server."

**Resume bullets.**
- Built bidirectional email integration (IMAP intake with loop/abuse protection and sender-verified threading; SMTP delivery with leasing, backoff and receipts) and a role-aware staff notification inbox delivered over commit-safe live pushes.

---

## 17. Customer portal and customer authentication

**Problem.** Customers could only reach the bank through staff or email. The brief asks for self-service intake from a web portal, which needs its own login, strict isolation from staff data, and a safe way to see progress.

**How a customer registers a complaint.** They sign in, choose "Make a complaint" (or "Make a request or ask a question"), enter a summary and details, and send. The API creates the ticket through the same intake path as email. A complaint is placed in the `complaint` category, so the regulatory clock (entry 8) starts immediately from receipt. The customer sees a reference such as `CASE-1A2B3C4D`, then follows status and staff updates and can reply.

### Identity: two separate worlds
- A **separate customer realm** (`bank-case-customers-dev`) with its own issuer, signing keys, audience (`bank-case-portal-api`) and client (`bank-case-portal`, authorization code with PKCE). `PortalAuthGuard` accepts only that issuer and audience; the staff guard accepts only the staff ones. Tested both ways: a customer token is rejected by the staff API (401) and a staff token by the portal API (401). A token minted for a different audience is also rejected.
- Signing algorithms are pinned (RS256, ES256, PS256) on both guards.
- The portal API is disabled (404) unless `PORTAL_OIDC_ISSUER` is configured.
- In production the bank would normally plug the portal into its existing online-banking login rather than create new customer accounts; this realm is the development stand-in and the contract (issuer, audience, a stable `sub`) is all the API needs.

### What the API exposes (`/v1/portal/*`)
- `POST /requests` (idempotent via `Idempotency-Key`), `GET /requests`, `GET /requests/{id}`, `POST /requests/{id}/messages`.
- A customer's identity becomes the opaque ticket reference `PORTAL-<account id>`. Every query is keyed by it, and only tickets that came through the portal are visible; someone else's ticket ID returns 404, never 403, so existence is not revealed.
- **Shown:** subject, the customer's own description, a friendly status (received, being worked on, waiting for your reply, resolved), complaint acknowledgement state and the final-response date, staff messages marked customer-visible, and messages staff sent over the portal channel.
- **Never shown:** internal notes, queues, assignees, SLA or escalation data, sensitivity, flags, or anything about tickets created by other means. A test asserts none of those words appear in responses.
- **Replies** are stored as the customer's own words, do not count as a staff response (so they can't stop a clock), move a ticket waiting on the customer back to in progress when the workflow allows, and notify the people working it. The logic is shared with email in `CustomerReplyService`.
- **Abuse limits:** 10 new requests and 30 messages per customer per hour (configurable), plus the global rate limit and body cap.
- **Staff → customer messages:** a staff user queues a `portal_update` communication; the server takes the recipient from the ticket itself (never typed in), and the delivery worker marks the portal channel delivered because the customer reads it there.

### The web app (`apps/portal`)
A small separate React app and container (own image, same runtime-configuration approach as the staff console): sign in, raise a request or complaint, list history, view progress and updates, reply. Built with accessibility in mind (labelled fields, fieldset/legend for the choice, live regions for confirmations and errors, focus moved to the heading when a request opens, visible focus ring, plain wording, a hint not to include card numbers or PINs). It has not yet had a formal accessibility audit.

### Delivery
Compose service `portal` on port 5174, Keycloak imports the customer realm automatically, and the Helm chart gained a portal Deployment, Service, Ingress on its own host, network policy, and the customer-IdP settings.

### Known limits
- No customer attachments yet; no identity verification of the customer (the bank's process); no customer-facing notifications by email on portal tickets beyond what staff send.
- The portal user must already exist in the customer IdP; self-registration is deliberately off.
- Rate limits are per customer account and per server instance.

**Interview summary.** "The portal is a thin, separately authenticated front end over the same intake path as every other channel. Customer and staff identities use different issuers and audiences, so a token for one can't be used on the other. Every portal query is keyed by the customer's own identity, returns 404 for anything else, and exposes a deliberately narrow view of the case. Replies reuse the same service as email, so the behaviour and the audit trail match."

**Resume bullets.**
- Built a customer self-service portal with an isolated customer identity realm, ownership-scoped API (404 on foreign IDs), per-customer rate limits and an accessible React front end, reusing the shared intake and reply services.

---

## 18. Authentication hardening

Everything here is configuration-driven so development stays simple and production turns it on. All of it was verified: unit tests for each control, and the live stack against real Keycloak realms.

| Control | How it works | Setting |
|---|---|---|
| **Pinned signing algorithms** | Only RS256, ES256 and PS256 are accepted on both the staff and customer guards; symmetric (HS256) tokens signed with any shared secret are rejected (tested). | always on |
| **Authorized-party check** | The token's `azp`/`client_id` must be one of the applications we expect, so a token minted for another app that happens to share the audience is refused. | `AUTH_ALLOWED_CLIENTS` |
| **Revocation (introspection)** | The API asks the IdP whether the token is still active (RFC 7662), caching the answer for a few seconds. If the user is disabled or the session ended, the token stops working within that window even though it has not expired. If the lookup fails, requests are refused (fail-closed) unless explicitly set to fail open. Verified live: after ending a user's session in Keycloak, the old token went from 200 to 401 within the cache window, while a new login worked. | `AUTH_INTROSPECTION_*` |
| **Central entitlements** | Optionally the bank's entitlement service decides roles, queues, branch, department, entity and country, falling back to token claims for anything it omits. A change there applies within a minute instead of at next login; a user the service doesn't know gets no access. | `ENTITLEMENT_URL` |
| **Step-up authentication** | Revealing references, approving or rejecting, legal-hold changes, subject-access export, complaints-register export and audit export require a login within `STEP_UP_MAX_AGE_SECONDS` (from the `auth_time` claim) and/or an accepted `acr` level. Failure returns `403` with code `step_up_required`; the console shows "Sign in again", which asks the IdP for a fresh login (`max_age=0`). Service identities are exempt. | `STEP_UP_*` |
| **Silent token renewal** | The staff console and portal renew tokens in the background and update the live stream, so people are not logged out mid-shift; a session the IdP ends signs the user out. | on |

**Other findings from running it for real.** Keycloak compares a token's issuer with the host a request arrives on, so introspection from inside the container failed until the IdP's public hostname was pinned (`KC_HOSTNAME`), which is also the correct production setup. Tokens obtained by the password grant carry no `auth_time`, so step-up only passes for browser logins; that is correct behaviour and the reason step-up is switched on per environment.

**Not code, but required.** Signed-JWT or mTLS client authentication for service identities, MFA and conditional access, idle timeout and concurrent-session limits are configured at the bank's identity provider; the API validates whatever tokens result. The development realm and its demo logins must never reach a shared environment.

**Known limits.** A backend-for-frontend with HTTP-only cookies would reduce token exposure in the browser further than session storage; it is a larger change and optional. Introspection adds a call per token per cache window, so keep the cache short but non-zero.

**Interview summary.** "I hardened authentication in layers that each fail safe: pinned algorithms, an allow-list of client applications, optional revocation checks against the IdP, optional central entitlements, and step-up on the few actions that reveal or export data. I proved revocation against a real Keycloak and found along the way that issuer consistency depends on the IdP's public hostname."

---

## 19. Audit hardening: restricted database account, richer context, before/after values, SIEM stream, signed anchors, archival

Entry 14 made the trail provable. This entry closes the gaps a bank's auditor would raise next. Every control below is covered by an integration test that attacks it.

**1. The application cannot tamper, even if it is compromised.** PostgreSQL lets a table's owner disable its triggers or rewrite it, and the application used to run as the owner. `infra/postgres/roles.sql` splits two accounts: `case_owner` owns the schema and runs migrations; `case_app` is what the API connects as. `case_app` can add and read audit events but has no UPDATE, DELETE or TRUNCATE on the audit tables and is not the owner, so it cannot disable triggers or drop the table. A statement-level trigger also blocks TRUNCATE for everyone. At start-up the API asks the database what its own account can do and reports `audit_runtime_role_safe`; `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` makes it refuse to start otherwise. The test creates both roles, runs the migrations as the owner, then proves the app account is refused on update, delete, truncate, disable-trigger and drop, while still doing everyday work.

**2. Richer actor context.** Every audit event now carries source IP, user agent, token ID and authentication level for the request that caused it (stored in the hashed metadata, so it is tamper-evident). Implemented with `AsyncLocalStorage` and a request hook, so no service had to be changed to pass it along. System actors (timer, workers) have no request, so they record none.

**3. Before and after values.** Ticket edits record old and new priority, which custom fields changed, and, for free text, only that it changed with old/new length and SHA-256 fingerprints, so the immutable trail proves the edit without storing content that retention might later need to remove. Assignments record from/to queue, assignee and status. Retention changes record the previous hold and date. Every configuration change (queues, categories, SLA, templates, routing rules, intake channels, regulatory profiles, holidays, workflows) records the previous row.

**4. Live feed to the SIEM.** With `AUDIT_STREAM_ENABLED=true` each audit event is also written to the outbox in the same transaction and published (topic `<prefix>.audit`), so the SIEM receives events as they happen and deleting recent events from the database can no longer hide them. Metadata is excluded unless `AUDIT_STREAM_INCLUDE_METADATA=true`, because it can contain staff-typed reasons.

**5. Signed anchors.** Anchors are signed with Ed25519 (`AUDIT_ANCHOR_SIGNING_PRIVATE_KEY`; keys from `scripts/generate-anchor-keys.mjs`) and verified with the public key. Once a signed anchor exists, every later anchor must be signed, so stripping a signature to hide a forgery is itself detected; anchors from before signing was enabled are still accepted. The signer is a small module that a bank can replace with a KMS/HSM call.

**6. Archival that keeps the chain verifiable.** Audit data must be kept for years, but the live table cannot grow forever, and removing old events used to look like tampering. `scripts/archive-audit.mjs` (run by the owner account, never the app) re-verifies the range it is about to archive and refuses a damaged one, writes it to a JSON-lines file with a manifest holding the file's SHA-256, records the newest archived event as the chain's new **base**, and deletes the range with the append-only triggers switched off for that one transaction only. The verifier then starts from the base, and anchors older than the base are no longer expected. Archiving the newest event is refused. A separate, deliberate `--accept-start` records an existing damaged start as trusted (for a database whose early events are already gone), explicitly accepting that earlier history cannot be verified. Tested: archive, verify valid, protections back on, and tampering after the archive is still caught.

**Restore verification.** After any database restore run `POST /v1/audit/verify?full=true` and compare the head with the last published anchor; an old backup will fail the anchor check, which is the point.

**Known limits.** The hash chain and the API share a database, so the signing key and the anchor destination must live somewhere database administrators cannot reach. Archive files must be kept in write-once storage by the bank. Failed validations (HTTP 400) are not audited by design; failed logins belong to the IdP and gateway. The single audit write lock remains.

**Interview summary.** "I assumed the application itself could be compromised and made the audit trail survive that: the app's database account physically cannot alter it, each event is streamed to the SIEM and hash-chained with its timestamp, anchors are signed and published off-database, and archiving old events is an owner-run, verified procedure that records a new trusted base. Every one of those claims has a test that tries to break it."

**Resume bullets.**
- Hardened a banking audit trail against insider and application compromise (least-privilege database roles proven by test, Ed25519-signed external anchors, SIEM streaming, verified archival with chain rebasing, request-context and before/after capture).

---

## 20. Operations and scale: dead letters, concurrency, paging, trends, reporting feed, scheduled exports

| Capability | What it does | Notes |
|---|---|---|
| **Dead-letter tooling** | `GET /operations/outbox/summary` and `/events`, `POST /operations/outbox/events/{id}/replay` and `/replay` (administrator). Events that failed five times can be returned to the queue with a fresh retry budget once the cause is fixed. Each replay is audited. Listing shows IDs and errors, never payloads. Admin screen shows counts per state and replay buttons. | Alert on the existing `outbox_events{status="dead_letter"}` metric. |
| **Optimistic concurrency** | Edit, assign and status-change requests may carry `expectedUpdatedAt`. If someone else changed the ticket since it was loaded, the API returns `409 stale_ticket` and the console refreshes the ticket and says so, instead of silently overwriting. | The console sends it on status changes. |
| **Paged ticket lists** | `GET /tickets?limit&cursor` is keyset-paginated (newest first, stable even as tickets arrive) with a new covering index; the next cursor is returned in the `X-Next-Cursor` header so the response shape did not change. The console has "Load more". | Tested: pages don't overlap and walking all pages finds everything. |
| **Trends** | `GET /dashboard/trends?weeks=N` returns weekly created, resolved, complaints and escalations plus breakdowns by category, branch and queue, scoped to the caller, audited. Dashboard shows tables with comparison bars. | |
| **Reporting data feed** | A read-only `reporting` schema (views for tickets, status history, escalations, communications) containing classifications, dates, outcomes and opaque IDs only: no subject, description, notes, references or free text. `infra/postgres/roles.sql` creates a `case_reporting` account that can read only these views. Tested: it is refused on `tickets`, notes and audit tables. | The bank's BI tool connects here instead of to case data. |
| **Scheduled exports** | Daily (`REPORT_EXPORT_ENABLED=true`) the complaints register for the last 30 days and weekly volumes are written as CSV to object storage per legal entity and country (`reports/<entity>-<country>/<date>/...`). Tested end to end against object storage; the free text of a complaint is verified absent from the file. | |
| **Delivery metrics** | `communications{status}` gauge for queued, sent, delivered and failed messages. | |

**Findings from testing.** Any action with no body but a JSON content type (such as "replay") was rejected with 400, which would have broken the console's own buttons; the server now treats an empty JSON body as `{}`. The schema owner needs permission to create schemas, which the role script now grants.

**Limits.** Paging applies to the list, not search (search remains a bounded top-50). Reporting views are not row-filtered by entity; a multi-entity deployment should give each reporting account only its own entity's data (single-tenant per bank makes this a non-issue). Scheduled exports are per entity/country across all queues.

---

## 21. Browser testing, accessibility, and what actually running it found

Until now no screen had been exercised in a real browser. `e2e/` holds Playwright tests that sign in through the real Keycloak pages and drive the staff console and the portal, with axe-core WCAG 2.1 A/AA checks (serious and critical violations fail the test) on the portal sign-in, home and request detail, and the staff sign-in, workspace, dashboard, administration and audit screens.

**Defects found by the browser and container runs, all fixed:**
1. **The staff console's "Create ticket" form had never worked.** It sent the reference fields both loose and inside `references`; the API correctly rejected the extras. No API test could see it.
2. **Colour contrast** on the status chips (green, amber, red) failed WCAG AA; the colours were darkened.
3. **Buttons with no body failed** (any POST carrying a JSON content type but no body returned 400). Fixed server-side by accepting empty JSON bodies using Nest's own body-parser hook. A first attempt using the raw Fastify hook crashed the real container at start-up and was only caught because the container was run, not just the tests.
4. **Connection-pool deadlock under load.** A stress test (many concurrent writers) hung: some code paths asked the pool for a second database connection while already holding one inside a transaction, and `pg` waits forever by default. Fixed the nested use, and made the pool bounded and fail-fast (`DATABASE_POOL_MAX`, connection, statement and idle-in-transaction timeouts). With the fix the audit chain stays valid under concurrent writers, even with a pool of 4.
5. **Duplicate accessible names** in the portal (a heading and a region both named "Details") was found by the tests; tests now target the field by role.

**What this does not replace.** It is an automated check, not an accessibility audit: axe finds roughly a third of real issues. A specialist review with assistive technology, keyboard-only walk-throughs and user testing with people who use screen readers is still required (see `production-readiness.md`).

**Interview summary.** "I treated 'it compiles and the unit tests pass' as insufficient: I ran the containers and a real browser against real identity providers. That found a create-ticket form that had never worked, a deployment crash, a connection-pool deadlock under concurrency, and contrast failures, none of which the earlier tests could see."

---

## 22. Hardening round: production safety guard, event catalogue, and a readable console

- **Production safety guard.** In production mode the API refuses to start if it is pointed at a local or development identity provider, uses the development database password or secrets, has no client allow-list, or is not required to run as the restricted database account, and it lists every problem at once. `ALLOW_DEV_SETTINGS=true` is the explicit override used only by the local container stack. This turns "the development realm must never reach a shared environment" from a warning into a control. Unit tested.
- **Event catalogue.** `docs/product/events.md` is generated from the source (a brace-aware scanner over every `outbox.enqueue`), listing 40 events with their aggregate, payload fields, envelope, topic and key, ordering and compatibility rules, so integrators (and any future schema registry) have one accurate reference that cannot drift. Regenerate with `node apps/api/scripts/generate-event-catalogue.mjs`.
- **Console structure.** The staff console's single main file (one line was 9,149 characters) is now a ~60-line shell plus two hooks (`use-session`, `use-workspace`) and focused components (create, list, detail, notes and status, communications, retention). The browser tests pass unchanged, which is the evidence that behaviour was preserved.

---

## 23. Operations documentation and a measured performance baseline

Added `docs/operations/capacity.md` (load-test results and storage growth, measured with `loadtest/`), `docs/operations/disaster-recovery.md` (what to protect, recovery steps including proving audit integrity after a restore), `docs/operations/runbooks.md` (alert-to-action procedures for every signal the platform emits) and `docs/product/user-guide.md` (by role). The load test showed ~230 ticket creations per second, ~950 audited list requests per second, zero errors, and a **valid audit chain after ~34,000 events written under concurrency**, which is the property that matters most and the one concurrency bugs would break.

---

## 24. SLA calendars, pause rules, admin screens for settings, supply-chain pinning

- **Business-hours SLAs.** A policy can count `business` minutes instead of wall-clock ones. Deadlines skip weekends, public holidays and time outside the country's working hours (time zone aware, daylight-saving safe: `addBusinessMinutes`, unit tested across a daylight-saving boundary). Working hours per country are configuration (`business_hours`, seeded for AU and IN); a policy with `wall` (the default) behaves exactly as before.
- **Pause while waiting for the customer.** A policy may stop the clock when a ticket moves to `pending_customer`. On resume (status change or the customer replying by email or portal) the deadlines move out by the time spent waiting, the status shows `paused` meanwhile, and the breach escalation ignores paused tickets. Regulatory (complaint) clocks are deliberately **not** paused: the regulator's deadline runs from receipt. Tested end to end: a business-hours deadline lands inside working hours, and a two-hour pause moves the deadline out by two hours.
- **Admin screens** for SLA policies (minutes, calendar, pause), business hours, and **message templates** (subject and body with a live preview). Templates accept only the placeholders `{{ticketRef}}` and `{{status}}`, validated server-side, so wording can never pull other case data into a customer message. Previously these were only reachable through the API.
- **Operational signals.** New metrics `attachments_pending_scan` and `attachments_oldest_pending_scan_seconds`, so a scanner outage is visible (downloads stay blocked meanwhile).
- **Supply chain.** Container base images are pinned to exact digests, and a Dependabot configuration proposes weekly updates for npm packages, base images and CI actions, each running the full CI before merge.

---

## 25. Alert rules and the Privacy Act correction workflow

**Alert rules.** `deploy/monitoring/alert-rules.yaml` holds 12 Prometheus alert rules that match `docs/operations/runbooks.md` one-for-one: audit chain invalid or stale, restricted-account check failing, dead-lettered and growing outbox events, customer messages not sending or failing, attachment scans stuck, API error rate and latency, API down, and breached deadlines. They were validated with `promtool` and ship with the Helm chart as a `PrometheusRule` (`metrics.prometheusRule.enabled`).

**Request to correct personal information (Privacy Act APP 13).** A second kind of regulated request alongside complaints, built on the same clock machinery rather than a parallel system:
- A regulatory profile now has a **kind** (`complaint` or `privacy_request`). The seeded Australian profile `au-app13-correction` acknowledges within 5 business days and responds within 30 days; the `privacy-correction` category uses it.
- Clocks, status recomputation, escalation triggers and notifications now key off "has a regulatory profile" instead of "is a complaint", so both kinds are timed, escalated and notified identically. Complaints stay the only kind in the **complaints register** and the complaint tiles; the dashboard reports privacy requests separately.
- **Resolution needs an outcome that fits the kind**: complaints use the complaint outcomes; privacy requests use `corrected`, `corrected_with_statement` or `refused_with_reasons` (APP 13 requires a statement when a correction is refused or the customer asks for one). A complaint outcome on a privacy request is rejected, and vice versa. Tested.
- The customer portal offers "Ask us to correct information we hold about me", shows the same acknowledgement and final-response dates, and the staff console shows the right outcome choices.

**Test hygiene.** The older ticket suite now isolates itself from events other suites leave behind, so all seven suites pass together against shared live services (28 integration tests), alongside 33 unit tests and 5 browser tests.

---

## 26. Automatic resolution notice, and auditor access to restricted cases

Two product decisions that the role review (`roles-and-access.md`) had flagged as open, now settled and built.

**Automatic resolution notice.** Before, a customer learned a ticket was resolved only if a person remembered to request the message (or the customer checked the portal). Now resolving a ticket queues the notice itself.

| Decision | What was built | Why |
|---|---|---|
| Where it runs | `ResolutionNoticeService.queue()` is called inside the same database transaction as the status change | A ticket can never be resolved without the notice being queued, or a recorded reason why not (atomic, same idea as the outbox) |
| It is an ordinary governed communication | Reuses `ticket_communications`, templates, approvals and the delivery worker; no parallel path | One set of controls, one delivery/retry/receipt path, nothing new to audit separately |
| Approval | Whatever the template says. `resolution_notice` (email) and the new `resolution_notice_portal` both require a supervisor; the request is made by `system:resolution-notice`, so any supervisor may approve (maker-checker still holds) | A complaint's final response is a regulated communication; an administrator can switch approval off per template |
| Channel and recipient | Portal ticket → portal message; email ticket → the address the customer wrote from (kept on the acknowledgement, because the ticket's own sender reference is a one-way pseudonym); every other channel → the customer reference, resolved by the bank's CRM contact lookup | Reach the customer where they already are, without storing contact data we do not own |
| Safety | Skipped (and audited) when customer communications are blocked on the case (tipping-off control), the ticket was de-identified, or a notice is already waiting. If no recipient or template exists, the assignee and supervisors are notified to contact the customer by hand | Nothing is sent that should not be, and nothing fails silently |
| Control | `ticket_categories.resolution_notice_enabled` (default on), set through the category API (`resolutionNoticeEnabled`) | A bank can turn it off for categories where a person always writes the final response |

**Limits.** The setting is available through the configuration API but has no checkbox in the administration screen yet. A ticket reopened and resolved again gets a new notice. Delivery to non-portal, non-email customers depends on the bank's contact lookup; without one, delivery records a clear `NO_CONTACT` failure rather than guessing.

**Auditor access to restricted cases.** Auditors may now read restricted-sensitivity tickets, their attachments (after the malware scan) and their audit events, in their own entity, country and queues. The reasoning: an auditor's job is to check that sensitive cases were handled properly, so being blind to exactly those cases defeats the role. It stays safe because auditors still hold no write permission at all (proven by a unit test that an auditor is refused `ticket:update` on the same restricted ticket), every view is audited like any other, and scope is still enforced. Agents still cannot see restricted tickets. A bank that wants a narrower rule can change one line in `PolicyService`.

**Verification.** Integration test: resolving a portal request queues exactly one pending notice, the customer sees nothing before approval, and sees the message after a supervisor approves and the delivery worker runs. Unit test for the auditor rule. All 19 database integration tests and 34 unit tests pass; lint and build are clean.

**Interview summary.** "I made 'tell the customer it is resolved' a side effect of the resolution itself, inside the same transaction, so it cannot be forgotten and cannot half-happen. It reuses the existing governed-communication path, so approval, tipping-off blocks, delivery retries and audit all apply for free. Separately I widened auditors to restricted cases, because an auditor who cannot see the most sensitive cases cannot do the job, and I kept it safe by keeping them strictly read-only and fully audited."

**Resume bullets.**
- Made customer resolution notices automatic and transactional (queued in the same transaction as the status change), reusing the maker-checker communication pipeline with tipping-off blocks and per-category opt-out.
- Redesigned auditor entitlements to cover restricted cases read-only, with unit-tested separation from write permissions and full audit of every access.

---

## 27. Customer documents in the portal

A customer on the phone or in the portal often has to prove something (identity, address, a statement). Before, only staff could attach files, and the email channel dropped attachments. A portal customer can now add documents to their own request.

| Decision | What was built | Why |
|---|---|---|
| Same pipeline as staff | `PortalAttachmentsService`: declare the file, get a one-time signed upload address, send the bytes **straight to object storage**, then confirm with a SHA-256 checksum and size. The existing ClamAV worker scans it; the existing download rule applies (no download until clean) | One set of controls for every file; the API never touches file bytes |
| Ownership | The request must belong to the signed-in customer (same proof as reading or replying); anyone else gets 404. Closed, cancelled or de-identified requests refuse uploads | A customer can never add to, or learn about, someone else's case |
| Limits | Types: PDF, JPEG, PNG, text. Size 10 MB (`PORTAL_MAX_ATTACHMENT_BYTES`), 10 documents per request, 20 uploads per hour | Tighter than staff because the door faces the public |
| Staff reaction | Completing an upload adds an ordinary customer reply ("The customer attached a document: name") through `CustomerReplyService`, so the SLA clock resumes, a `pending_customer` ticket returns to in progress, and the assignee is notified, exactly as for a typed reply | No special cases: a document is just another way for the customer to answer |
| What the customer sees | A list of their documents as *Being checked*, *Received* or *Not accepted*. Scan details are never described | Does not help an attacker probe the scanner |
| Audit | Upload intent and completion are audited and published as the same events staff uploads use, marked `source: portal`, actor `customer:portal` | Same evidence trail |
| Fails safe | Without object storage configured the portal says uploads are unavailable (503) and creates nothing | No local-disk fallback |

**Browser plumbing.** The portal's content-security-policy needed the object store's address (`CSP_CONNECT_SRC`), and the object store must accept the portal's origin; both are deployment settings (the Helm chart's `cspConnectSrc` for the portal).

**Limits.** Customers cannot download or delete a document after sending it. A caller with no portal account still cannot send a file directly; the natural next step is a secure upload link sent to them by SMS or email, reusing this same pipeline. Email attachments are still not imported.

**Verification.** Integration test against the real object store and ClamAV: a stranger gets 404, a disallowed type 400, an oversized file 413; a clean file is *Being checked* and staff get 409 on download until scanned; after the scan the clean file is *Received* and downloadable, and the EICAR test virus is *Not accepted* and stays blocked. A Playwright test uploads a file from the portal in a real browser with an accessibility check. 34 unit tests, 19 database integration tests (plus the live-storage test) and 5 browser tests pass.

**Interview summary.** "I opened the same upload pipeline to customers instead of building a second one: signed direct-to-storage upload, checksum, antivirus before release, and an audit trail. The customer-facing difference is tighter limits and an ownership check, and an upload counts as a customer reply so the SLA clock and the case team react as they do for any message."

**Resume bullets.**
- Added scanned customer document upload to the portal (signed direct-to-storage upload, checksum, ClamAV gating, size/type/count/rate limits), reusing the staff attachment pipeline end to end.
- Verified with live-service integration tests (including the EICAR virus test) and a real-browser accessibility test.

---

## 28. Secure upload links for callers without a portal account

A customer who phones the bank has no portal login, yet may need to send identity or address documents. Staff can now send them a secure link by email or SMS; opening it lets them send documents to that one request and nothing else.

| Decision | What was built | Why |
|---|---|---|
| Staff do nothing new | A *document request* message template (email and SMS) whose body contains `{{uploadLink}}`. Queuing it from the ticket's existing Communications panel creates the link in the same transaction | The message reuses every control already built: template approval setting, the tipping-off block, masked recipients, delivery with retries and receipts, audit. No second sending path to secure |
| The link is not stored | The token is `linkId.signature`, where the signature is an HMAC of the ID with a server secret (`UPLOAD_LINK_SECRET`). The table holds only the ID, ticket, expiry, file limit and revocation | A database leak does not reveal a single usable link; the delivery worker can rebuild the link from the ID when it sends the message |
| Where the token travels | In the address after `#`, then in a request header (`X-Upload-Token`), never in a URL path or query | Browsers never send the part after `#` to servers, so it stays out of proxy and web-server logs |
| What the link allows | Send documents to one ticket: the same signed direct-to-storage upload, checksum and malware scan as the portal and staff. It cannot read the ticket, its notes, or any document | Write-only; the least a document request needs |
| When it works | Only while: genuine, not expired (72 h by default), not withdrawn, its message is approved and queued/sent/delivered, and the request is open and not de-identified. File count limited (5 by default) | A rejected or unapproved message never activates a link; closing a case ends it |
| One answer for every failure | Forged, expired, withdrawn, unapproved or closed all return the same "not valid or has expired" | Nothing for an attacker to learn from the difference |
| Withdrawal | `DELETE /v1/tickets/{id}/upload-links/{linkId}` by someone who can update the ticket; audited | For a message sent to the wrong person |
| Shared code | The portal's document service was generalised into "who is uploading and under what authority" (`UploadAuthority`); portal customers and link holders then share the same limit, storage, scan and reply logic | Two doors, one set of rules |
| Staff react as to any customer message | A completed upload adds a customer reply ("The customer attached a document: name"): SLA clock resumes, status returns from *waiting for customer*, the case team is notified | Consistent with portal uploads |

**Operational.** Needs `UPLOAD_LINK_SECRET` (signing key; the start-up guard refuses the development value in production) and `PORTAL_PUBLIC_URL` (the portal's public address used in the link). Without both, a document request is refused. Two new events (`upload_link.created`, `upload_link.revoked`) are in the event catalogue.

**Limits.** The link is a bearer credential: anyone who has the message can use it until it expires, so the default lifetime is short and the file count small; a bank should choose values with its fraud team. There is no staff screen listing or revoking links yet (the API exists). The link's lifetime starts when the message is created, not when it is approved.

**Verification.** Unit tests for token forgery, editing, extension and secret rotation. Integration test against the real object store and virus scanner: a link cannot be sent through the portal channel; forged tokens all get 404; a real upload is *Being checked* then downloadable by staff only after the scan; the file limit is enforced; withdrawal kills the link. A Playwright test does the whole story in real browsers: a supervisor queues the request in the console, the email arrives in the test mail server, a separate browser with no session opens the link, uploads a file (with an accessibility check), and a damaged link shows only a plain refusal. 38 unit, 23 database integration (live storage) and 6 browser tests pass.

**Interview summary.** "Callers have no account, so I issued a signed, expiring, single-ticket link instead. The signature is derived from the link ID with a server key, so nothing usable is stored. The link only lets you add documents to one case; every failure looks identical; and because staff send it through the normal governed-message path, approvals, tipping-off blocks, delivery and audit all apply without new code."

**Resume bullets.**
- Designed a stateless, HMAC-signed, expiring, single-purpose upload link for unauthenticated customers (token in the URL fragment and a header, uniform failure responses, per-link file limit, revocation).
- Reused the governed communication pipeline and the scanned-upload pipeline end to end, verified in a live multi-browser, real-mail-server test.

---

## 29. A real interface: rebuilt staff console and customer portal

The backend was bank-grade but the screens were a test harness: about 890 lines of React for the whole console, 19 lines of minified CSS, no URLs (the current screen was a `useState`, so refresh lost your place and nothing could be linked), a three-column grid where the create form permanently took a third of the screen, a ticket list made of buttons, and a ticket detail that stacked nine panels in one column because each backend feature had appended one. For a product a bank would buy and staff would use all day, the UI was the weakest part. Both front ends were rebuilt on the existing API client and sign-in code; the API itself needed one permission change (below).

| Decision | What was built | Why |
|---|---|---|
| A design system, not hand-written CSS | **Mantine 8** components and a theme (`apps/web/src/theme.ts`) with one brand palette. A `cssVariablesResolver` swaps in darker shades wherever a colour is used for text or behind white text | Consistent, accessible components out of the box. Mantine's stock colours fail WCAG AA contrast (white on blue-6 is ~3.6:1); the overrides make every badge, button and caption pass, which the axe checks enforce. A bank re-brands by changing one palette |
| A URL for every screen | **React Router**: `/tickets`, `/tickets/:id`, `/dashboard`, `/audit`, `/admin/:section`. The queue keeps view, filters and search in the query string; the case screen keeps the open tab | Refresh, Back, bookmarks and shared links all work. The person opening a link still only sees what their own access allows |
| Return to the page you asked for | The wanted path travels through the identity provider in the OIDC `state`; after the redirect the console navigates there. Only same-site paths are accepted (`/x`, not `//evil.example`) | Deep links survive sign-in and step-up, without an open-redirect hole |
| Server data in a cache | **TanStack Query** for every read; keys built in one file (`lib/query-keys.ts`). Changes go through `useTicketMutation`, which re-reads the ticket and writes it into the case screen and every cached list. A 409 ("changed by someone else") re-reads automatically | Loading and error states come for free, two components share one request, and the hand-written merge logic of the old `use-workspace` hook disappears |
| Live updates feed the cache | The SSE stream still carries only an ID. On an event the ticket is re-read over REST and patched into the caches; a 403/404 removes it from lists and the open case shows "not available"; a reconnect invalidates everything | Same security property as before (events reveal nothing; policy is applied on read), now without manual state juggling |
| A real queue | **TanStack Table** with sortable columns (ticket, status, priority, next SLA due, queue, assignee, age), quick views with counts (Open, Assigned to me, Unassigned, Overdue, Complaints, All) and filters | The case worker's main screen is a sortable list, not a pile of buttons |
| A case screen | Header (subject, badges, *Assign*, *Change status*), description, then tabs: Activity, Communications, Attachments, Related, Compliance, Retention (supervisors), Audit trail (auditors); a summary sidebar with SLA due times and masked references | The summary is always visible and the detail is one click away, instead of a long scroll |
| Forms that know the user | *New ticket* is a dialog; branch, department, entity and country come from `/me` (the API requires them to match the creator's scope anyway); category pre-selects its queue | Removes busywork and a class of "outside your scope" errors |
| API features finally reachable | Assign / return to pool, edit priority and description, customer-visible replies, and the audited **reveal** of customer references (step-up) existed in the API but had no screen | The console now covers the permission matrix in `roles-and-access.md` |
| Role-aware, not role-enforcing | `session/roles.ts` maps roles to capabilities (`workTicket`, `supervise`, ...) to decide what to *show*. Administrators land in Administration and get no live feed | A tidy screen per role; the API stays the only authority |
| One feedback channel | Failed changes raise a toast from one place (the query client's mutation cache); successes confirm; loading uses skeletons; errors offer *Try again* | Replaces a single red banner that was easy to miss and never cleared |
| Charts that follow the rules | Created-vs-resolved is a two-series line chart (validated colour-blind-safe pair, legend always shown, table toggle). Single-measure breakdowns are HTML bar rows with the number printed beside each bar | Small values stay readable without hovering, and the bars read as a plain list to screen readers |
| Administration by area | Seven tabs (routing, intake, service levels, compliance, workflows, templates, integration events), each a list plus a *New/Edit* dialog. Workflows render as readable "from → to" moves; the JSON editor validates as you type. Templates preview live | Replaces fourteen forms on one page |
| Portal | Same design system, plain-English wording, a chat-style conversation, document status badges, and focus moved to the opened request for screen-reader users | Customer-facing quality to match the staff console |
| Fast first load | Dashboard, audit and administration load on demand; libraries are split into cacheable vendor chunks; charts load only with the dashboard | A case worker's first screen downloads about 220 KB (gzip) |

**API change.** `GET /configuration/regulatory-profiles` was administrator-only, so the console's *Mark as complaint* drop-down could never load for the case workers who use it. Reading active profiles (labels and day counts, filtered to the user's jurisdiction) is now allowed for roles that can update tickets; editing is still administrator-only (`roles-and-access.md` updated). When no profile is listed for the user's jurisdiction, the console falls back to typing the profile key.

**Defects found by running it, all fixed.** Running the containers and real browsers (not just the compiler) found four problems:
1. **A crash on typing** in the audit search and the new-ticket form: a state updater read `event.currentTarget` after React had cleared it. The value is now read before the updater runs.
2. **ARIA on the wrong element**: the notification popover put `aria-haspopup` on the badge wrapper instead of the button.
3. **An unlabelled close button** on toast messages.
4. **`aria-label` on a plain `div`** in the loading skeleton, which ARIA forbids (now a `role="status"` region with hidden text).

Visual review from screenshots also caught truncated status badges, a clipped unread count and wrapping column headers.

**Limits.** Sorting and quick views apply to the tickets already loaded (50 per page, newest first); the search endpoint returns basic fields only, so views are disabled while searching. A server-side filtered queue would need new API parameters. Dark mode is not offered (the contrast overrides are tuned for white). The portal and console each carry a copy of the theme; a shared package would remove that. The axe checks are automated and do not replace a specialist accessibility review.

**Verification.** Web and portal type-check, lint and build cleanly; 38 API unit tests pass. Seven Playwright tests pass against the full container stack (real Keycloak, ClamAV, object storage, mail server), with axe WCAG 2.1 A/AA checks on the queue, case screen, dashboard, administration, audit console and portal. New coverage: a deep link survives sign-in; a refresh keeps the case open; notes and the status dialog; the admin tabs; auditors get no *New ticket* button.

**Interview summary.** "The backend was solid but the UI was a test console, which would sink a bank demo. I rebuilt both front ends on Mantine, React Router and TanStack Query/Table. Every screen got a URL, and deep links survive OIDC sign-in safely. Server data moved into a cache that the existing SSE feed keeps fresh. The ticket detail became a proper case screen, and actions the API already supported but no screen exposed now have one. Running it in real browsers with accessibility checks found a crash and three ARIA faults before any user did."

**Resume bullets.**
- Rebuilt a banking case-management console and customer portal in React (Mantine, React Router, TanStack Query and Table): URL-addressable screens, a sortable and filterable queue, and a tabbed case workspace, with code-splitting bringing the first screen to about 220 KB gzipped.
- Wired server-sent live events into a query cache with policy-checked re-reads, and implemented safe post-login deep links via OIDC state with open-redirect protection.
- Enforced WCAG AA contrast through theme-level colour overrides and verified with Playwright and axe across seven end-to-end flows against a full container stack.

---

## 30. People shown by name: a staff directory

Tickets and the audit trail store a person as their identity-provider **subject ID** (for example `dd8a043a-e38f-...`), which is right for evidence (it never changes or gets reused) but useless on screen: the assignee, "created by", note authors and every audit actor appeared as an ID.

| Decision | What was built | Why |
|---|---|---|
| Keep IDs in the data, add names for display | A `staff_directory` table (subject ID → display name, username, email, entity, country, queues, roles). Nothing that stores a person changed | The record stays stable and auditable; names are a presentation layer |
| Where names come from | The token's standard `name`, `preferred_username` and `email` claims. `GET /me` (called once when the console opens) upserts the caller's row. A failure is logged and never blocks sign-in | No new integration needed locally; a bank can fill the same table from its HR directory (for example over SCIM) |
| Lookup | `POST /directory/lookup` (up to 200 IDs → names), limited to the caller's entity and country, for any staff role; `GET /directory/people?queue=` lists case agents and supervisors, for supervisors and administrators only | POST keeps lists of IDs out of URLs and logs. Staff names only, never customer data |
| Console | One `<PersonName>` component used for assignee, created by, note authors, status history, ticket audit trail, audit search and queue members. Requests made in the same few milliseconds are batched into one call and cached | A 50-row table makes one request, not 50. The exact ID stays available in a tooltip (and in the audit event detail), because the ID is what the evidence records |
| Pick people by name | The Assign dialog and "Add queue member" are searchable lists of names; leaving the assignee empty still returns the ticket to the queue | Supervisors no longer paste IDs |

**Limits.** A person appears by name only after they have opened the console once (until then the short ID is shown, with a tooltip explaining why); a bank would preload the directory from its HR system. Names in the directory update when the person next signs in. The audit search's Actor filter still takes an ID.

**Verification.** API type-check, 38 unit tests and the API boundary tests pass; the migration applied in the container stack. Browser checks with the case agent and auditor: "Created by Local Case Agent", the note author and the queue's Assignee column show names, and the auditor's search shows the actor's name, with the accessibility check passing. The supervisor flow (assign by name) is in `staff.spec.ts` but could not run here because the local `local-supervisor` account had MFA (a one-time code) enabled in Keycloak for an experiment.

**Interview summary.** "Evidence should reference a stable identifier, people should see a name. I kept subject IDs in tickets and the audit trail and added a scoped staff directory fed from the token's standard claims, with a batched, cached lookup in the UI so a full table costs one request."
