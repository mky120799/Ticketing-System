# Bank Case Platform — first working increment

Security-first local scaffold for a bank ticketing platform. It uses PostgreSQL for authoritative ticket and append-only audit data, and Keycloak only as a **development OIDC provider**. The application does not create, store, or verify local passwords.

The design baseline, permission matrix, architecture boundaries, API strategy, phased plan, risks, and pilot acceptance boundary are documented in [`docs/architecture.md`](docs/architecture.md). The implemented slice and its deliberate production boundaries are in [`docs/first-increment.md`](docs/first-increment.md).

## Run locally

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`.
2. Start services: `docker compose up -d`. PostgreSQL is published on local port `5433` to avoid conflicting with an existing local PostgreSQL installation.
3. Install dependencies: `npm install`.
4. Run the migration with `DATABASE_URL` exported from `apps/api/.env`: `set -a; . apps/api/.env; set +a; npm run migration:run --workspace=@bank-case/api`.
5. Start the API: `npm run dev:api`; start the web app separately with `npm run dev:web`.

To exercise the database-backed lifecycle slice after the migration, run `npm run test:integration --workspace=@bank-case/api`.

Keycloak is available at `http://localhost:8080`. The imported development realm includes `local-branch-agent` with password `local-dev-only-change-me`; this credential exists only inside the disposable Keycloak development realm and is not handled by the application. Change or remove it before sharing the environment. The API health checks are `GET /v1/health/live` and `GET /v1/health/ready`.

## Security properties delivered

- OIDC JWT verification against issuer, audience, expiry, signature and JWKS.
- Server-side default-deny permissions plus branch, queue, and sensitivity checks.
- Masked customer references by default; a separate controlled reveal action is audited.
- Idempotent ticket creation with request fingerprint conflict detection.
- Transactional, hash-chained audit events for material ticket actions, with PostgreSQL-enforced append-only mutation protection.
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
- The React workspace exposes masked communication history, template-based requests, and supervisor approval actions while relying on the API for authorization.
- Authorized users see ticket changes live over an SSE stream fed by transactional `pg_notify`; events are policy-filtered per subscriber and carry no customer data (see `docs/implementation-log.md`).
- Configurable auto-assignment (least-loaded/round-robin) and an SLA timer with idempotent, audited multi-level escalation run as system actors, safe across multiple API instances.
- Scoped ticket search returns minimized metadata only; descriptions, references, notes, and communication recipients are excluded from search results.

## Deliberate pilot boundaries

Camunda, a bank-approved Kafka/event bus (a Kafka publisher exists but is untested against a broker), bank source-system adapters, object storage delivery, and production telemetry are intentionally not wired in this increment. The notification provider boundary is represented by a narrowly scoped delivery-receipt callback, not a provider client. Redis is included only as an optional local cache seam and is not required for correctness. Notes, basic lifecycle transitions, and governed communication requests are present; long-running SLA/workflow orchestration belongs to the next approved pilot slice. See `docs/first-increment.md`.
