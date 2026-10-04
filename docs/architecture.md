# Bank case platform architecture brief

This document is the design baseline for the secure bank ticketing and case-management platform. It complements the executable local scaffold in this repository. The platform is intended for complaints, service requests, disputes, fraud investigations, KYC/document updates, card and ATM issues, and internal operational escalations. It does not introduce AI automation before the control framework and human-review workflows are approved.

## 1. Assumptions and validation questions

The design assumes that the bank already operates an enterprise identity provider, API gateway, secrets/KMS capability, approved event bus, object storage, SIEM, and source-system APIs. The case platform is not granted direct database write access to core banking, CRM, card, payment, KYC, fraud, or document-management systems.

The bank must confirm:

- Which IdP issuer, audiences, claims, assurance levels, MFA and step-up mechanisms are approved for staff and customer channels?
- Which legal entities, countries, branches, departments, queues, data classifications, retention schedules, and legal-hold rules apply to the pilot?
- Which systems are authoritative for customer, account, card, loan, transaction, fraud, KYC, and document data, and what APIs/events are available?
- Which Kafka/event-bus topics, schemas, service identities, mTLS profiles, retry policies, and reconciliation procedures are approved?
- Which Camunda 8 cluster, worker identity model, BPMN governance process, and SLA calendar are approved?
- Which S3-compatible storage, malware scanning, content-disposition, key-management, and immutable-backup controls are required?
- Which notification providers and templates are approved, and which communication types require maker-checker approval or customer verification?
- Which metrics, traces, log fields, SIEM routes, RTO/RPO targets, load profile, and support ownership apply to the pilot?

## 2. Roles and permission model

Authorization is server-side, default-deny, and combines RBAC with branch, queue, department, legal-entity, country, ticket-sensitivity, assignment, and purpose-of-access policies.

| Role | Core permissions | Explicit restrictions |
|---|---|---|
| Branch Agent | Create and read in own branch and entitled queues | No restricted-ticket reveal, approval, assignment, export, or configuration administration |
| Call-Center Agent | Create and read in entitled queues under call-center scope | No restricted-ticket reveal, approval, assignment, export, or configuration administration |
| Case Agent | Create, read, update, add notes, progress cases in assigned/entitled queues | No approval of own actions; no restricted-ticket reveal unless separately entitled |
| Supervisor | Scoped read/update, assignment, cancellation, approval, reveal, dashboard | Still limited to legal entity/country/queue scope; cannot approve own action |
| Auditor | Scoped read, audit reports, compliance dashboards | No ticket mutation, assignment, reveal, approval, or communication send |
| Administrator | Configuration lifecycle only | No implied access to case content, customer references, or operational mutation |
| Service identity | Narrow API/event capability for one integration | No interactive login or broad human permissions |

Service identities are split by purpose: `attachment-scanner` can finalize malware state, `integration-reconciler` can record published-event receipts, and `notification-provider` can record delivery receipts only.

Every material action is checked against the current token claims and ticket attributes. Frontend visibility is convenience only and never an authorization boundary.

## 3. Core journeys and lifecycle

### Ticket intake

1. A branch, call-center, portal, mobile, email-ingestion, or internal system submits a validated ticket with an idempotency key and correlation ID.
2. The API validates OIDC claims, queue/branch/entity scope, category configuration, references, sensitivity, and required fields.
3. PostgreSQL writes the ticket, masked/opaque references, SLA deadlines, audit event, and minimized outbox event in one transaction.
4. The case appears only in queues and scopes allowed to the caller.

### Case work

1. A case agent opens the ticket; the view is audited and references remain masked.
2. The agent adds internal/customer notes, links related or duplicate tickets, attaches metadata/upload intents, assigns work, and moves through allow-listed states.
3. External system data is retrieved through approved APIs only when the current user has the required purpose and entitlement.
4. High-risk changes, restricted data reveals, exports, and approval-gated communications require step-up or maker-checker controls.

### Resolution and communication

1. The case agent proposes a resolution and selects a governed communication template.
2. Routine messages enter `queued`; approval-gated messages create a linked pending approval.
3. An independent supervisor approves or rejects. Only approval transitions a communication to the delivery-intent state.
4. A bank-approved notification adapter publishes through the event bus/provider and records delivery receipts without putting message bodies or recipient data into logs/events.

### Lifecycle states

`submitted -> triage -> assigned -> in_progress -> pending_customer | pending_external | pending_approval | escalated -> resolved -> closed`.

Permitted exceptional transitions include cancellation by a supervisor and reopening of resolved/closed cases. Each transition stores actor, reason, timestamp, correlation ID, and an audit-chain event. Camunda owns long-running timers and escalation orchestration in the pilot-grade phase; the transactional service remains the source of truth for case state.

## 4. Functional and non-functional requirements

Functional requirements include multi-channel intake, configurable categories/queues/forms, opaque references, notes, attachments, relationships, customer communications, assignment, approvals, SLA timers, escalations, dashboards, audit reporting, exports with authorization, and integration reconciliation.

Non-functional requirements include:

- Security: OIDC/OAuth 2.1 with PKCE, MFA/conditional access through the bank IdP, mTLS for services, KMS/Vault-managed secrets, least privilege, default deny, masking, immutable audit, and no sensitive data in telemetry or events.
- Reliability: transactional outbox, idempotency, bounded retries, dead-letter handling, reconciliation, PostgreSQL HA/backups, and defined RTO/RPO.
- Performance: p95 API latency and event lag budgets agreed per journey; pagination and indexed scoped queries; no unbounded ticket or audit reads.
- Availability: Kubernetes/OpenShift deployment across failure domains with readiness/liveness probes and graceful dependency degradation.
- Privacy: data minimization, classification-aware access, retention schedules, legal holds, subject-access/deletion procedures where legally applicable, and tokenized source references.
- Operability: OpenTelemetry traces, Prometheus metrics, structured redacted logs, SIEM forwarding, alert ownership, runbooks, and audit/reconciliation dashboards.
- Change safety: migration review, schema/event compatibility, feature flags, rollback plans, SAST/DAST/dependency scanning, and UAT/security sign-off.

## 5. High-level architecture

```text
Staff web / mobile / customer portal / controlled intake adapters
                 |
       Bank API gateway / WAF / rate limits
                 |
       OIDC session + OAuth2 access token
                 v
  React UI ---- Case API (NestJS + Fastify)
                 |  Auth/policy, ticket, SLA, approvals, communications
                 |  Audit, configuration, reporting, idempotency
                 v
  PostgreSQL (authoritative cases, config, approvals, outbox, audit chain)
                 |
                 +--> Transactional outbox --> Kafka / approved event bus
                 |                              |--> Camunda workers/SLA
                 |                              |--> notification adapters
                 |                              |--> source-system adapters
                 |
                 +--> Encrypted S3 object storage --> malware scanner
                 +--> Redis (short-lived cache/idempotency coordination only)
                 +--> OpenSearch (masked/minimized search projection)

  OpenTelemetry --> collector --> metrics/logs/traces --> SIEM/Grafana
  Vault/KMS/HSM --> service secrets, encryption keys, signing/configuration
```

The case API owns transactional consistency and policy enforcement. Camunda, Kafka, Redis, OpenSearch, object storage, and external providers are adapters or projections and cannot bypass the API's authorization and audit boundary.

## 6. Data model and boundaries

Authoritative PostgreSQL entities are:

- `tickets`: lifecycle, scope, sensitivity, subject, controlled description/custom JSONB, creator, assignment, SLA policy and deadlines.
- `ticket_references`: source system, reference type, opaque reference, masked display value, classification. Raw source values are never copied to events, search, analytics, or logs.
- `ticket_notes`, `ticket_status_history`, `ticket_relationships`, and `attachments`: case activity and metadata with actor/time relationships.
- `communication_templates` and `ticket_communications`: approved channel/template, masked recipient, status, approval link, and provider correlation. Message bodies and raw recipients stay inside the protected communication boundary.
- `approval_requests`: maker-checker request, requester, linked communication where applicable, decision, and audit/outbox correlation.
- `sla_policies`, `case_queues`, `ticket_categories`, `communication_templates`: governed configuration with effective scope, approval requirements, and versioning in the pilot-grade design.
- `ticket_retention_controls`: retention date and legal-hold state are separated from case content, scoped, audited, and consulted by retention/deletion workers.
- `audit_events`: append-only hash-chained event records with operational metadata only; a database trigger rejects update/delete mutations.
- `idempotency_records` and `integration_outbox`: replay protection and transactional integration delivery state.

Attachments contain bytes only in encrypted object storage. PostgreSQL stores object key, checksum, size, classification, upload state, and malware status. The API uses an S3-compatible presigned PUT/GET seam, with bounded URL TTL and server-side encryption configuration; without storage configuration it remains metadata-only and never falls back to local disk. Only a distinct scanner service identity can finalize scan state; unscanned or non-clean content is never downloadable. Search and analytics use masked/minimized projections with explicit field allow-lists.

## 7. API and integration strategy

The API is versioned under `/v1`, uses JSON validation, correlation IDs, idempotency keys for creates, and consistent 401/403/409/422 semantics.

Representative endpoints:

```text
GET  /v1/health/live                         process probe
GET  /v1/health/ready                        dependency readiness
GET  /v1/me                                  current authorized identity
GET  /v1/configuration/queues|categories     scoped active configuration
POST /v1/tickets                             idempotent ticket creation
GET  /v1/tickets                             scoped list
GET  /v1/tickets/search?q=...                scoped minimized metadata search
GET  /v1/tickets/{id}                        audited masked detail
PATCH /v1/tickets/{id}                       governed update
POST /v1/tickets/{id}/assignments            scoped assignment
POST /v1/tickets/{id}/notes                  internal/customer note
POST /v1/tickets/{id}/status                 allow-listed transition
POST /v1/tickets/{id}/attachments            encrypted-object upload intent
POST /v1/tickets/{id}/attachments/{attachmentId}/scan  scanner-service result callback
GET  /v1/tickets/{id}/attachments/{attachmentId}/download  clean-attachment signed URL
PUT  /v1/tickets/{id}/retention              supervisor-scoped retention/legal hold
POST /v1/tickets/{id}/communications         governed template request
POST /v1/tickets/{id}/approvals              controlled action request
POST /v1/tickets/{id}/approvals/{approvalId}/decision
POST /v1/dashboard/sla/reconcile              scoped overdue-state reconciliation hook
GET  /v1/dashboard/summary                   scoped aggregates
GET  /v1/audit/tickets/{id}                  auditor-only report
GET  /v1/audit/tickets/{id}/export           audited masked report export
POST /v1/integrations/outbox/{eventId}/receipts  reconciler-service receipt
POST /v1/integrations/communications/{communicationId}/receipts  notification-provider delivery receipt
```

All integrations use approved APIs, event streams, or bank middleware. The outbox publisher is the only path from a committed case mutation to an external event. Consumers must be idempotent, schema-versioned, correlation-aware, and free of customer content. Failed delivery is retried with bounded backoff, dead-lettered, alerted, and reconciled.

The local increment implements search against indexed PostgreSQL ticket metadata as a safe read-side seam. It returns only opaque ID, subject, category, priority, status, sensitivity, queue, branch, and timestamp; descriptions, references, notes, and communication recipients are excluded. The pilot replaces this implementation with an OpenSearch projection after the field allow-list and reconciliation process are approved.

## 8. Authentication, security, privacy, and audit

The application does not store passwords. Staff and customer authentication are delegated to approved IdPs using Authorization Code + PKCE or the bank's equivalent customer flow. The API validates issuer, audience, signature, expiry, JWKS, subject, roles, scopes, and required branch/queue/department/entity/country claims for human tokens. Dedicated service identities such as the attachment scanner and integration reconciler use separate narrowly scoped roles and do not receive human ticket-context claims. Short-lived access tokens and IdP-controlled session expiry/logout are required.

Sensitive references are masked by default. Reveal, export, restricted attachments, approval, and high-risk configuration actions require explicit permission, contextual policy, and an audit event. Service-to-service calls use separate identities, narrow scopes, mTLS, and network policy. Secrets are never committed or logged.

Audit events cover login/logout outcomes at the edge, denied authorization, ticket view/edit/create, assignment, reveal, export, note/status/relationship/attachment activity, communication request/approval/send outcome, approval decisions, configuration changes, integration retries, and report access. Events are append-only, hash-chained, replicated to the bank SIEM, retention-controlled, and protected from application-user mutation.

## 9. Phased implementation plan

### Phase 0 — design and bank readiness

Confirm claims, queues, data classifications, authoritative systems, event schemas, RTO/RPO, retention, IdP/API-gateway integration, and security/privacy threat model.

### Phase 1 — first working increment

Deliver the local NestJS/React scaffold, PostgreSQL migrations, development Keycloak only, JWT/policy guards, roles, ticket CRUD, idempotency, masking, append-only audit, notes/status, attachment metadata, relationships, scoped dashboard/audit views, transactional outbox, governed communications, an optional fail-open Redis cache seam, tests, CI, and documentation. This repository contains this slice; external providers remain adapters to be approved.

### Phase 2 — controlled pilot

Integrate the bank IdP and gateway, Camunda SLA/workflow workers, approved Kafka/event bus, production Redis coordination/cache policy, encrypted object storage and malware scanning, one source system, one notification channel, OpenTelemetry/SIEM, operational runbooks, and reconciliation. Pilot one legal entity, a small queue set, and synthetic/UAT data first.

### Phase 3 — expand and harden

Add more channels and source systems, OpenSearch projections, customer portal/mobile flows, advanced dashboards, retention/legal holds, DR exercises, performance testing, security testing, accessibility, localization, and production change governance.

### Phase 4 — optimization after control maturity

Only after measurable control effectiveness and human-review sign-off consider assistive automation. Any future AI capability must be bounded, explainable, non-authoritative, privacy-reviewed, and unable to approve, reveal, send, or close a case without an authorized human action.

## 9a. Status against this plan (2026-10-03)

Phase 1 is complete and Phase 2 is built as far as it can be without the bank's systems: the workflow definition layer (engine-agnostic, so a BPMN engine can be added without redesign), an in-application timer with the same rule tables a workflow engine would take over, the outbox with a verified Kafka publisher, encrypted-storage and malware-scan flows verified against S3-compatible storage and ClamAV, real email intake and delivery, a customer portal with a separate identity realm, and the operational material (metrics, alerts, runbooks, recovery and capacity plans). Phase 3 items delivered early: retention and legal holds, trends and a BI reporting feed, accessibility checks. What remains is listed in `production-readiness.md`.

## 10. Technology choices

- React + TypeScript provides a typed, accessible operator UI and shared validation contracts.
- Node.js 22 LTS + NestJS + Fastify provides modular dependency boundaries, strong middleware/guard support, and efficient I/O for API/integration workloads.
- PostgreSQL is authoritative for transactions, JSONB configurable fields, relational integrity, migrations, and audit/outbox atomicity.
- Camunda 8 is appropriate for long-running BPMN workflows, timers, escalations, and human tasks; it is not the system of record.
- Kafka or the bank-approved event bus supports durable integration, replay, partitioning, and consumer isolation.
- Browser live updates use Server-Sent Events fed by PostgreSQL LISTEN/NOTIFY, not WebSockets; actions remain REST. WebSockets are reserved for a later bidirectional need such as customer chat (see `docs/implementation-log.md`).
- Until Camunda timers are provisioned, SLA evaluation and escalation run in an in-app scheduler guarded by a Postgres advisory lock; the rule tables and events are the contract Camunda workers would later take over.
- Redis is limited to short-lived cache/coordination and never becomes the authoritative case store.
- S3-compatible encrypted object storage is used for attachment bytes; OpenSearch receives only minimized search projections.
- OIDC/SAML through the bank IdP, gateway/WAF, Vault/KMS/HSM, Kubernetes/OpenShift, and OpenTelemetry align the platform to existing bank controls.

## 11. Risks, dependencies, and open decisions

The highest risks are identity-claim mismatch, unclear source-system ownership, unapproved data replication, event/schema drift, attachment malware handling, retention/legal-hold conflicts, cross-country data residency, queue entitlement errors, provider delivery ambiguity, and insufficient operational ownership. Dependencies include bank IdP/gateway onboarding, Kafka/Camunda/storage provisioning, security and privacy review, API contracts, SIEM onboarding, UAT data, DR capacity, and support runbooks.

Open decisions include the authoritative customer-verification flow, exact data classifications, approval thresholds, SLA calendars and business holidays, event schema registry, reconciliation ownership, notification provider, search field allow-list, retention/legal-hold implementation, and production deployment topology.

## 12. First working increment acceptance boundary

The increment is accepted when protected local OIDC login works without application passwords; required roles and claims are enforced; ticket create/list/detail/update/assignment and scoped policy checks work; creation is idempotent; references are masked; audit events are append-only/hash-chained; maker-checker self-approval is denied; notes, statuses, relationships, attachment metadata, scoped dashboard/audit reporting, and governed communication approval are transactional and tested; React login/create/list/detail screens work; Docker, migrations, environment templates, CI, lint/build/unit/integration/e2e tests, and security documentation are present.

It is not production approval. Before production, replace the local IdP, inject secrets via Vault, configure gateway/WAF/mTLS/KMS, provision approved Camunda/event bus/storage/search/observability, complete threat-model/privacy/security review, and exercise backup, restore, retention, legal-hold, malware, reconciliation, and disaster-recovery controls.
