# Interview preparation

Every topic folder has its own `interview-qa.md`. This page is the **cross-topic** layer: the general technique, a one-line answer per topic, and the honest limitations worth volunteering.

- **Technique:** [Answer playbook](answer-playbook.md). How to answer "how did you implement it?" at 30-second, 2-minute and code level.
- **Cross-module follow-ups:** [Reference maps](../reference/README.md).

---

## The answer structure (use it every time)

```text
Boundary/entry point → identity and input → service decision (policy, rules)
→ transaction, locks, idempotency, tables → audit/outbox/live/worker effects
→ frontend cache and error behaviour → the test that proves it → an honest limitation + fix
```

---

## One-line answers per topic

| Topic | One-line answer | Deep Q&A |
|---|---|---|
| Auth | "OIDC code + PKCE in React; a Nest guard verifies the JWT against JWKS with an algorithm allow-list, issuer, audience, client, revocation and entitlements, builds `UserContext`; `PolicyService` combines RBAC with row attributes; step-up and maker-checker for sensitive actions." | [auth/interview-qa.md](../auth/interview-qa.md) |
| Audit | "Same-transaction audit writes, a SHA-256 hash chain over canonical JSON serialised by an advisory lock, append-only triggers plus a restricted DB role, scheduled verification, and signed external anchors that catch tail deletion." | [audit/interview-qa.md](../audit/interview-qa.md) |
| Tickets | "One transaction per use case: load, policy, rules, write, then audit + outbox + `pg_notify` on the same client; idempotent create; keyset paging; the UI refetches and patches caches." | [tickets/interview-qa.md](../tickets/interview-qa.md) |
| SLA | "Deadlines computed at creation with a time-zone-aware business calendar, stored on the ticket, paused while waiting on the customer, status re-derived by one SQL CASE in skip-locked batches." | [sla/interview-qa.md](../sla/interview-qa.md) |
| Workflow | "Lifecycles as database graphs validated for reachability; transitions checked in the same transaction; a try-advisory-locked scheduler runs timers on one instance." | [workflow/interview-qa.md](../workflow/interview-qa.md) |
| Assignment and routing | "Per-queue advisory lock + most-specific rule + least-loaded/round-robin; escalation re-locks and claims a unique ticket-rule row." | [assignment-and-routing/interview-qa.md](../assignment-and-routing/interview-qa.md) |
| Communications | "Durable governed messages: the template decides approval; maker-checker with step-up; a leased worker resolves contacts at send time; idempotent, monotonic receipts." | [communications/interview-qa.md](../communications/interview-qa.md) |
| Notifications | "Scoped rows created in the causing transaction, audience evaluated at read time, per-user read state, content-free SSE hint." | [notifications/interview-qa.md](../notifications/interview-qa.md) |
| Attachments | "Presigned one-object uploads; the scanner re-hashes streamed bytes through ClamAV; only clean files are downloadable; HMAC links in the URL fragment for account-less customers." | [attachments/interview-qa.md](../attachments/interview-qa.md) |
| Compliance | "Regulatory profiles as data; the clock starts at receipt; skip-locked reconciliation; outcomes required; communication blocks; step-up privacy and register exports with formula-safe CSV." | [compliance/interview-qa.md](../compliance/interview-qa.md) |
| Retention | "Step-up legal holds; an opt-in hourly job deletes files then locks, re-checks and de-identifies, keeping a skeleton; known file-delete race fixed by a pending-redaction state machine." | [retention/interview-qa.md](../retention/interview-qa.md) |
| Intake | "Normalised adapter messages, advisory lock + ledger with content hash for exactly-one ticket, routing never crosses entity; email adds loop protection, HMAC senders, owned threading." | [intake/interview-qa.md](../intake/interview-qa.md) |
| Portal | "A separate issuer/audience/guard; ownership derived from the token subject via the reference join; customer-safe projections; DB-counted rate limits." | [portal/interview-qa.md](../portal/interview-qa.md) |
| Outbox | "Event inserted with the change; skip-locked claim, publish outside locks, backoff, dead letter; at-least-once with `eventId` de-duplication; Kafka keyed by aggregate." | [outbox/interview-qa.md](../outbox/interview-qa.md) |
| Live updates | "Transactional `pg_notify`, one LISTEN per instance, policy-filtered SSE, closed at token expiry, resync on reconnect, the client refetches." | [live-updates/interview-qa.md](../live-updates/interview-qa.md) |
| Configuration | "Domain data with permission, scope, reference and before-value audit in one transaction; re-validated at use time." | [configuration/interview-qa.md](../configuration/interview-qa.md) |
| Dashboard | "Every aggregate uses the same scope parameters; `COUNT FILTER` and `generate_series`; numbers only." | [dashboard/interview-qa.md](../dashboard/interview-qa.md) |
| Directory | "Immutable subject IDs in records, names in a scoped directory refreshed best-effort, batched lookups." | [directory/interview-qa.md](../directory/interview-qa.md) |
| Database | "Bounded pool with timeouts, a transaction helper, the same-client rule, the right lock per problem." | [database/interview-qa.md](../database/interview-qa.md) · [locking catalogue](../database/locking-and-concurrency.md) |
| API bootstrap | "Safety check first; Fastify with redacted logs; Helmet, rate limit, ALS, strict CORS, whitelist validation; global denied-audit interceptor." | [api-bootstrap/interview-qa.md](../api-bootstrap/interview-qa.md) |
| Observability | "A route-template-labelled HTTP interceptor; business gauges at scrape time; a token-protected scrape; live vs ready vs safety." | [observability/README.md](../observability/README.md) |
| Cache | "Optional, lazy, TTL-bound, fail-open Redis; never authoritative." | [cache/README.md](../cache/README.md) |
| Frontend | "Providers in dependency order; capability-gated routes for UX; one typed API client; TanStack Query with hierarchical keys and a shared mutation hook; SSE triggers refetches." | [frontend-architecture/interview-qa.md](../frontend-architecture/interview-qa.md) |

---

## Honest limitations worth volunteering

Say them before you're asked, using the pattern *current guarantee → gap → fix → proof*.

| # | Limitation | Fix | Where |
|---|---|---|---|
| 1 | Ticket optimistic check isn't atomic (lost update possible under truly simultaneous edits) | `UPDATE ... WHERE updated_at = $expected`, zero rows → 409; two-connection test | [tickets](../tickets/mutations-and-concurrency.md#3-the-concurrency-gap-be-honest-about-this) |
| 2 | Manual assignee not validated against queue membership | In-transaction membership query | [manual assignment](../assignment-and-routing/manual-assignment.md#3-the-known-gap-the-assignee-is-not-validated) |
| 3 | Retention deletes files before the locked hold re-check | Pending-redaction state machine | [retention](../retention/how-it-works.md#4-the-cross-store-race-be-honest-about-this) |
| 4 | Staff create: concurrent first use of an idempotency key returns an error to the loser | Catch `23505` and replay, or an advisory lock | [tickets](../tickets/create-read-search.md#24-the-idempotency-race-know-this-one) |
| 5 | Scan worker has no claim (duplicate work) | `SKIP LOCKED` + lease | [scanning](../attachments/malware-scanning.md#5-known-limitation-no-claim-or-lease) |
| 6 | Single audit chain lock limits audited write throughput | Per-entity chains or Merkle batches | [audit](../audit/interview-qa.md#4-honest-limitations) |
| 7 | Business SLA pause shifts by wall-clock time | Recompute remaining business minutes | [SLA](../sla/how-it-works.md#3-pause-and-resume) |
| 8 | Raw DB errors (bad UUID, unique races) surface as 500 | SQLSTATE-aware exception filter, `ParseUUIDPipe` | [request lifecycle](../api-bootstrap/request-lifecycle.md#4-errors) |

---

## Practice cards

For each, speak 30 seconds, then 2 minutes, then sketch the code or SQL:

1. Staff login and token verification. [auth/login-flow.md](../auth/login-flow.md)
2. Ticket creation and idempotency. [tickets/create-read-search.md](../tickets/create-read-search.md)
3. Status change and the stale-update gap. [tickets/status-change-flow.md](../tickets/status-change-flow.md)
4. Audit append and integrity verification. [audit/event-model.md](../audit/event-model.md), [integrity](../audit/integrity-and-anchors.md)
5. Outbox crash windows. [outbox/how-it-works.md](../outbox/how-it-works.md#6-crash-windows-memorise-this-table)
6. Attachment upload and scan. [attachments/staff-upload-flow.md](../attachments/staff-upload-flow.md)
7. Communication maker-checker and delivery receipts. [communications](../communications/creating-and-approving.md)
8. Portal ownership and customer reply. [portal/backend.md](../portal/backend.md)
9. Dashboard scope-safe aggregates. [dashboard](../dashboard/how-it-works.md)
10. React Query mutation and SSE convergence. [frontend-architecture/data-fetching.md](../frontend-architecture/data-fetching.md)

Score yourself: **0** technology names only · **1** names of classes, no state or failure · **2** service + transaction path · **3** + concurrency/idempotency + frontend recovery · **4** + tests tied to guarantees + honest limitation and fix.
