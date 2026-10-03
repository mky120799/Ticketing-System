# Bank Case Platform

Security-first case-management and ticketing platform for banks: a modular monolith (NestJS API, React console, PostgreSQL) deployed single-tenant per bank, with jurisdiction rules, workflows and routing held as configuration. It uses PostgreSQL for authoritative ticket and append-only audit data, and Keycloak only as a **development OIDC provider**. The application does not create, store, or verify local passwords.

The design baseline, permission matrix, architecture boundaries, API strategy, phased plan, risks, and pilot acceptance boundary are documented in [`docs/architecture.md`](docs/architecture.md). The implemented slice and its deliberate production boundaries are in [`docs/first-increment.md`](docs/first-increment.md).

## Run locally

**Everything in containers (needs Docker):**

```bash
docker compose --profile app up -d --build     # Postgres, Redis, Keycloak, migrations, API, web
open http://localhost:5173                     # sign in as local-supervisor (password below)
npm install && npm run intake:simulate --workspace=@bank-case/api   # simulate an incoming email
```

**For development (hot reload):**

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`.
2. `docker compose up -d` starts PostgreSQL (published on `5433`), Redis and Keycloak.
3. `npm install`, then run migrations: `set -a; . apps/api/.env; set +a; npm run migration:run --workspace=@bank-case/api`.
4. `npm run dev:api` and `npm run dev:web`.

If you ran an earlier version, recreate Keycloak to import the current realm: `docker compose up -d --force-recreate keycloak`.

Tests: `npm test` (unit), `npm run test:e2e`, and `npm run test:integration --workspace=@bank-case/api` (needs a migrated, otherwise empty database). Deployment, security and onboarding guides: [`docs/deployment.md`](docs/deployment.md), [`docs/security.md`](docs/security.md), [`docs/bank-onboarding.md`](docs/bank-onboarding.md). How each feature was built: [`docs/implementation-log.md`](docs/implementation-log.md).

Keycloak runs at `http://localhost:8080`. The development realm has `local-branch-agent`, `local-case-agent`, `local-case-agent-2`, `local-supervisor`, `local-auditor` and `local-admin`, all with password `local-dev-only-change-me`, plus an `intake-gateway` service client (secret `local-dev-only-intake-secret`). These credentials exist only in the disposable development realm and are never handled by the application; remove them before sharing an environment. Health checks: `GET /v1/health/live` and `GET /v1/health/ready`.

## Security properties delivered

- OIDC JWT verification against issuer, audience, expiry, signature and JWKS.
- Server-side default-deny permissions plus branch, queue, and sensitivity checks.
- Masked customer references by default; a separate controlled reveal action is audited.
- Idempotent ticket creation with request fingerprint conflict detection.
- Transactional, hash-chained audit events (timestamps included in the hash) with PostgreSQL-enforced append-only protection, scheduled integrity verification, daily externally published anchors, auditor search, and audited list views.
- An approver cannot approve their own controlled action.
- Notes and allow-listed lifecycle transitions are stored with actor, reason, and audit history.
- New tickets receive persisted priority-based first-response and resolution deadlines from `sla_policies`.
- Attachments use an S3-compatible presigned upload/download seam when configured; PostgreSQL stores metadata only, upload completion preserves checksum, and content remains pending malware scan until approved scanning completes. Without storage configuration, the API stays metadata-only and never uses local disk.
- Only the distinct attachment-scanner service role can transition uploaded attachments from pending scan to clean, malicious, or scan error; the download route rejects unscanned/non-clean content and only issues a bounded signed URL after a clean scan.
- Related, duplicate, and parent/child ticket links are stored with foreign-key integrity and audit events.
- Supervisor/auditor dashboard summaries expose scoped queue workload, aging, and overdue-SLA aggregates only.
- Supervisor-scoped retention and legal-hold controls require a reason, are audited, and exclude hold reasons from outbox events.
- Ticket mutations enqueue minimized transactional outbox events with row-locked claiming, bounded retries, and dead-letter state for the future bank event-bus publisher.
- A background dispatcher delivers outbox events at-least-once through a pluggable log or Kafka publisher, with crash recovery.
- A distinct integration-reconciler service can record idempotent external receipts for published outbox events without submitting customer payloads.
- A distinct notification-provider service can record idempotent, monotonic communication delivery receipts (`sent`, `delivered`, `failed`) without exposing recipients or provider payloads.
- Governed customer-communication requests accept only active templates, mask recipient references, support approval-gated status, and enqueue minimized delivery events without recipient content.
- Administrator-only queue/category configuration writes are legal-entity/country scoped, audited, and emitted through the transactional outbox without granting ticket-content access.
- Administrator-only SLA policy writes validate bounded response/resolution windows and emit audited configuration events for the future workflow worker.
- Communication templates are configuration-backed; active templates can be listed safely and only administrators can change channel or approval requirements.
- Supervisor/administrator SLA reconciliation is idempotent, scope-limited, and emits minimized overdue-state events for future workflow escalation.
- Auditors can retrieve scoped ticket audit reports with event hashes and no customer-content payloads.
- Audited report exports are available to auditors and preserve the same masked/minimized event payload.
- Redis is an optional, fail-open cache for safe active communication-template metadata; PostgreSQL remains authoritative and template writes invalidate the cache.
- Queue and category choices are configuration-backed and filtered by the caller's authorization claims.
- The React workspace exposes masked communication history, template-based requests, and supervisor approval actions while relying on the API for authorization. It also provides SLA/escalation timeline, checksummed direct-to-storage attachments, linked tickets, auditor hash-chain view, a scoped dashboard, and an administrator routing console.
- Authorized users see ticket changes live over an SSE stream fed by transactional `pg_notify`; events are policy-filtered per subscriber and carry no customer data (see `docs/implementation-log.md`).
- Configurable auto-assignment (least-loaded/round-robin) and an SLA timer with idempotent, audited multi-level escalation run as system actors, safe across multiple API instances.
- Channel adapters (email, portal, mobile, phone, internal) create tickets through one idempotent intake endpoint under a least-privilege `intake-gateway` service identity, with admin-managed per-channel routing.
- Regulatory complaint handling is configuration: profiles define acknowledgement and final-response clocks (Australian ASIC RG 271 defaults seeded), with business-day maths, IDR outcomes, external-scheme tracking, vulnerability flags, a communication block for tipping-off control, and an audited complaints register export.
- SLA status uses measured first-response and resolution timestamps; resolving requires a root cause.
- The API sets strict security headers, rate limits clients, caps request bodies and redacts credentials from logs.
- Opt-in retention enforcement de-identifies expired closed tickets (respecting legal holds) while keeping the immutable audit trail; ticket lifecycles are per-category data; Prometheus metrics are token-protected.
- Scoped ticket search returns minimized metadata only; descriptions, references, notes, and communication recipients are excluded from search results.

## What is and isn't done

**Built and verified locally** (PostgreSQL 18, Docker, real Keycloak): ticket lifecycle with per-category workflows, RBAC and scoping, immutable audit, outbox dispatcher, live updates, SLA and regulatory clocks, complaints (ASIC RG 271 profile as data), assignment and escalation, intake channel stub, retention enforcement, subject-access export, dashboards and register export, hardened containers and a Helm chart.

**Deliberately not in this repository** (needs the bank's environment): the bank IdP and gateway, a Camunda or other BPMN engine (workflows are data-driven and engine-agnostic; see `docs/implementation-log.md` entry 9), a Kafka cluster (a publisher exists but has not been run against a broker), real object storage and malware scanning, source-system adapters (core banking, CRM, cards, KYC, fraud), real notification providers, customer portal and mobile identity, SIEM and tracing endpoints.

**Before production:** threat-model workshop and penetration test with the bank, accessibility audit, load and disaster-recovery tests, retention schedules approved, security and privacy sign-off. See [`docs/security.md`](docs/security.md) section 7 for the full list of known gaps.
