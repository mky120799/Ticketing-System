# Code-level module interview answers

Use this as a recall sheet, then open the linked guide for the full algorithm, failures and tests. Every answer names an entry point, provider, persistence/reliability mechanism and frontend effect.

| Module/area | “How did you implement it?” answer starter | Deep guide |
|---|---|---|
| Application/bootstrap | “`main.ts` creates Nest on Fastify after safety checks, then installs redacted logging, Helmet, rate limit, request context, strict CORS, validation and `/v1`; `AppModule` composes all providers and a global denial interceptor.” | [Guide](../modules/application-bootstrap.md) |
| Health/safety | “Liveness is process-only, readiness runs `SELECT 1`, and unsafe production configuration throws before listen.” | [Guide](../modules/health-and-production-safety.md) |
| Authentication | “OIDC PKCE in React; Nest verifies access-token JWKS signature, issuer/audience/algorithm/client, optional revocation and entitlements, then builds `UserContext`.” | [Guide](../modules/authentication/README.md) |
| `/me` profile | “A guarded endpoint returns normalized context and best-effort refreshes Directory; it drives UI only, never later API trust.” | [Guide](../modules/authentication/profile-and-me.md) |
| Authorization | “Policy combines role permission with entity/country/queue/branch/ownership/sensitivity, then step-up, maker-checker and workflow add action controls.” | [Guide](../modules/authorization.md) |
| Audit | “Domain services pass the same transaction client to a serialized hash-chain append; restricted DB roles and signed external anchors protect/detect tampering.” | [Guide](../modules/audit/README.md) |
| Tickets | “The guarded controller delegates to an aggregate service that validates scope/state and commits ticket rows, audit and outbox together; specialist providers own SLA, assignment, files and notices.” | [Guide](../modules/tickets/README.md) |
| Dashboard | “Every aggregate applies actor entity/country/queue predicates in SQL; React renders returned counts and never uses a tile as access proof.” | [Guide](../modules/dashboard.md) |
| Portal | “A separate customer guard derives ownership from token subject; safe projections, replies and uploads always query through that ownership.” | [Guide](../modules/portal.md) |
| Intake | “Adapters normalize messages; a durable channel/message-id/hash record gives idempotency, then routing/ticket/SLA/audit/outbox commit atomically.” | [Guide](../modules/intake.md) |
| Email | “Inbound mail proves sender ownership and delegates to Intake/Reply; outbound workers lease durable communications and reconcile idempotent receipts.” | [Guide](../modules/email.md) |
| Notifications | “Rows target a subject or queue/role/scope, read state is per user, and SSE carries only a refetch hint; opening the ticket reauthorizes.” | [Guide](../modules/notifications.md) |
| Workflow | “Lifecycle is a database-backed directed graph validated for terminal reachability; transitions are checked in the ticket transaction, and a single-lock scheduler runs timers.” | [Guide](../modules/workflow.md) |
| Configuration | “Administrators upsert validated scoped domain configuration; previous summary, audit and change event commit in one transaction.” | [Guide](../modules/configuration.md) |
| Compliance | “Structured complaint/privacy facts select regulatory profiles and timezone-aware calendars; scoped step-up exports avoid copying personal data into audit.” | [Guide](../modules/compliance.md) |
| Integrations | “Machine-authenticated callbacks lock durable rows, enforce monotonic transitions and use unique business keys so exact retries replay and contradictions conflict.” | [Guide](../modules/integrations.md) |
| Outbox | “Events are inserted with business state, skip-locked dispatchers publish at least once, failures back off/dead-letter and consumers deduplicate event id.” | [Guide](../modules/outbox.md) |
| Storage/uploads | “API stores authority/metadata and returns one-object presigned URLs; scanner hashes actual streamed bytes and only clean content can be downloaded.” | [Guide](../modules/tickets/attachments-scanning-and-upload-links.md) |
| Directory | “Stable IdP subjects remain database identity; scoped Directory rows decorate them with mutable names and supply bounded picker options.” | [Guide](../modules/directory.md) |
| Live events | “Domain transactions call `pg_notify`; each API instance LISTENs and policy-filters SSE hints, closes at token expiry and clients refetch REST.” | [Guide](../modules/live-events.md) |
| Metrics | “A global interceptor labels method/route-template/status; token-protected Prometheus gauges use bounded labels and no customer ids.” | [Guide](../modules/metrics.md) |
| Operations | “Privileged APIs inspect minimized outbox metadata and replay only dead letters in bounded audited transactions; scheduled reports are scope-separated.” | [Guide](../modules/operations.md) |
| Retention | “A bounded system job deletes bytes/de-identifies due closed tickets and publishes evidence; current delete-before-hold-lock race requires a pending-redaction state machine.” | [Guide](../modules/retention.md) |
| Database | “One bounded injectable pool provides transactions; same client binds domain/audit/outbox, while runtime privilege checks ensure audit cannot be rewritten.” | [Guide](../modules/database.md) |
| Cache | “Redis is lazy, TTL-bound and non-authoritative; failure becomes a miss, and security-sensitive operations revalidate PostgreSQL.” | [Guide](../modules/cache.md) |

## Four implementation caveats worth volunteering

Strong interview answers identify limitations without undermining the design:

1. General ticket stale checks are not atomic under truly simultaneous writes; use `UPDATE ... WHERE updated_at=expected RETURNING`.
2. Manual assignment must validate submitted assignee against active target-queue membership.
3. Retention needs a durable cross-store pending state to close the legal-hold/object-deletion race.
4. Concurrent first use of an idempotency key prevents duplicate commit through the unique key/rollback, but the losing request should catch/replay rather than expose a database conflict.

## Answer template

```text
Boundary and entry point
  -> authenticated identity and policy inputs
  -> service algorithm and validation
  -> transaction/lock/idempotency and tables
  -> audit/outbox/live/worker behavior
  -> frontend cache/error behavior
  -> failure test and known limitation
```

This structure answers “how” at code level rather than listing technologies.
