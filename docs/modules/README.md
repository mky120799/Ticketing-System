# Application modules

This is the code-level module index. Every guide identifies Nest wiring, routes/controllers, provider responsibilities, transaction/data flow, authorization, audit/outbox behavior, frontend participation, failure cases, tests and an interview-ready “how I implemented it” answer.

Completeness is tracked against the source tree in [Source-to-documentation coverage](source-coverage.md): all **22 Nest modules**, plus non-module controllers/workers and frontend features.

For cross-module comparison, use the [implementation reference maps](reference/README.md): [runtime wiring](reference/runtime-wiring-map.md), [data and consistency](reference/data-and-consistency-map.md), [frontend-to-backend](reference/frontend-to-backend-map.md), and [failure/test evidence](reference/failure-and-test-map.md).

## Application platform

| Area | Runtime focus | Detailed guide |
|---|---|---|
| Root composition | `AppModule`, provider graph, lifecycle hooks | [Application composition and bootstrap](application-bootstrap.md) |
| HTTP bootstrap | Fastify, Helmet, limits, CORS, validation, request context | [Application composition and bootstrap](application-bootstrap.md) |
| Probes and fail-fast checks | liveness, readiness, production configuration | [Health and production safety](health-and-production-safety.md) |

## Security and evidence

| Module | Backend focus | Frontend focus |
|---|---|---|
| [Authentication](authentication/README.md) | JWT/JWKS verification, `UserContext`, revocation, entitlements, step-up | OIDC Code + PKCE, session lifecycle, bearer API calls |
| [Authorization](authorization.md) | RBAC + resource attributes, scope, sensitivity, maker-checker | Capability-based navigation without trusting UI security |
| [Audit](audit/README.md) | Transactional append, hash chain, denied actions, verification, anchors | Scoped search, ticket evidence, step-up export |

## Case and customer work

| Module | Backend focus | Frontend focus |
|---|---|---|
| [Tickets](tickets.md) / [subsystems](tickets/README.md) | Aggregate, idempotency, reads, concurrency, SLA, assignment, approvals, scanning | List/detail, tabs, mutations, stale-edit handling |
| [Dashboard](dashboard.md) | Scope-safe aggregate SQL and SLA reconciliation | Summary/trend queries and widgets |
| [Customer portal](portal.md) | Separate customer identity, ownership and safe projections | Customer request/history/replies/documents app |
| [Intake](intake.md) | Adapter normalization, durable message idempotency, routing | Portal submission and intake administration |
| [Email](email.md) | Inbound ownership/idempotency and outbound leases/receipts | Communication status and customer-visible updates |
| [Notifications](notifications.md) | Audience targeting, per-user read state, live hints | Notification menu and authorized navigation |
| [Directory](directory.md) | Stable subject-to-name mapping and scoped assignee lookup | Person-name resolution and pickers |

## Rules, configuration and lifecycle

| Module | Backend focus | Frontend focus |
|---|---|---|
| [Workflow](workflow.md) | Transition graph validation, scheduler locks, idempotent escalation | Workflow editor and allowed status choices |
| [Configuration](configuration.md) | Queues, categories, SLA, templates and routing upserts | Administration sections and refetch behavior |
| [Compliance](compliance.md) | Complaints, business-time deadlines, privacy/report exports | Ticket compliance tab and regulatory configuration |
| [Retention](retention.md) | Eligibility, legal-hold recheck and cross-store redaction | Hold/date controls and redacted-state handling |

## Messaging, infrastructure and operations

| Module | Backend focus | Frontend/operations focus |
|---|---|---|
| [Integrations](integrations.md) | Idempotent receipts and monotonic delivery state | Reconciled communication/outbox status |
| [Outbox](outbox.md) | Transactional enqueue, skip-locked claims, retry/dead letter | Operational status; browser refetches authority |
| [Storage and uploads](storage-and-uploads.md) | Presigned URLs, capability links, checksum and malware scan | Direct upload flow and safe status labels |
| [Live events](live-events.md) | Commit-time PostgreSQL notify, subscriber policy and SSE expiry | React Query invalidation/resync |
| [Metrics](metrics.md) | Low-cardinality Prometheus interceptor/gauges | External dashboards and alerts, not product UI |
| [Operations](operations.md) | Audited dead-letter replay and scoped scheduled reports | Admin recovery workflow |
| [Database](database.md) | Bounded pool, transactions, locks and runtime-role checks | Stable API errors; no direct database access |
| [Cache](cache.md) | Optional fail-open Redis optimization with scoped keys | Distinction from per-session React Query cache |

## Suggested study order

For an interview-ready understanding, follow one request before reading everything horizontally:

1. [Staff authentication flow](../flows/staff-authentication.md): browser redirect → token → `AuthGuard` → `UserContext`.
2. [Tickets](tickets.md): controller → DTO → policy → transaction → database.
3. [Ticket change and audit](../flows/ticket-change-and-audit.md): workflow + audit + outbox + live event → React refetch.
4. [Portal](portal.md) and [Intake](intake.md): the same domain entered through a different identity/channel.
5. [Audit report flow](../flows/audit-report.md): scoped evidence search and step-up export.
6. Infrastructure modules: Outbox, Storage, Database, Cache, Metrics and Operations.

## The interview explanation pattern

For any module, answer in this order:

1. **Boundary:** what the module owns and deliberately does not own.
2. **Entry point:** controller route, worker tick or frontend action.
3. **Identity and policy:** how the actor is authenticated and scoped.
4. **Implementation:** providers called, transaction/locks/idempotency and tables changed.
5. **Evidence and propagation:** audit, outbox, notification/live behavior.
6. **Frontend:** request, state/cache update and error handling.
7. **Failure proof:** the most important test and what happens during retry/concurrency.

Do not answer only “I used guards and JWT.” Name the guard/service, the decision data, where the check occurs and how the write is made safe.
