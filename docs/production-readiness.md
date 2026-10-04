# Production readiness

What the platform has today, and what must still be done before it runs a real bank's cases. Written for a decision-maker: it separates what is **required** from what is **recommended** or **optional**, so nothing blocking is hidden and nothing optional blocks go-live.

Last updated 2026-10-03. Progress is marked inline with ✅. Companion documents: [`project-status.md`](project-status.md) (feature list), [`security.md`](security.md) (threat model and control mapping), [`deployment.md`](deployment.md), [`bank-onboarding.md`](bank-onboarding.md), [`implementation-log.md`](implementation-log.md) (how each feature was built).

## How to read this

| Label | Meaning |
|---|---|
| **Done** | Built and tested locally (PostgreSQL 18, Docker, real Keycloak, and where noted Kafka, S3-compatible storage and ClamAV) |
| **Partly** | Built, with a named gap |
| **Not done** | Not built |
| **MUST** | A bank will not approve go-live without it |
| **SHOULD** | Expected by a mature bank; go-live with a documented, time-boxed plan is possible |
| **OPTIONAL** | Valuable but not required for go-live |
| **Owner** | Us (engineering), Bank (needs the bank's systems/people), or Third party (external assessor) |


## 0. Where things stand

Progress is marked inline with ✅. Of the 82 required (MUST) and recommended (SHOULD) items below, **40 are done**. The **27 MUST items still open** depend on the bank's environment, people or an external assessor (identity provider, production infrastructure, storage and encryption, integrations, compliance review, penetration test, accessibility audit, user acceptance testing, disaster-recovery exercise); only 1 of them is engineering work that waits on a code host (running the security workflows in the real repository). Of the 15 SHOULD items still open, 5 are engineering items: skills and shift-aware assignment, richer workflow guards, customer attachments in the portal, a zero-downtime upgrade rehearsal and a wider automated test suite.

Verified: 33 unit tests, 28 integration tests across 7 suites against live PostgreSQL, Keycloak, Kafka-compatible broker, object storage, ClamAV and a mail server, and 5 browser tests (with accessibility checks) against the containerised stack.

## 1. Scorecard

| Area | Built | Production gaps |
|---|---|---|
| Case management core | Strong | Few |
| Authorization and data protection | Strong | Step-up, central entitlements |
| Audit trail | Hardened and attack-tested | Bank-side: immutable anchor destination, SIEM, DBA monitoring, restore test |
| Workflow and automation | Good | Optional engine adapter, richer guards |
| Australian compliance | Good | Specialist review, correction workflow (APP 13) |
| Authentication | Hardened (pinned algorithms, client allow-list, revocation, step-up, entitlements, silent renewal) | Real enterprise IdP untested; MFA and session policy at the IdP |
| Notifications | Delivery and staff inbox built | Real CRM lookup and SMS gateway (bank); editor UI |
| Intake channels and customer portal | Real email intake and customer portal built | Customer attachments; bank login integration |
| Integrations and events | Kafka verified against a broker | Source-system adapters, schema registry |
| Attachments | Verified end to end | Production store/scanner config |
| Reporting and analytics | Operational reporting | Trends, scheduled exports, BI feed |
| Platform, operations and resilience | Containers, Helm, metrics | Live-cluster install, DR, load, runbooks |
| Security assurance | CI scanning written | Pen test, DAST, threat-model workshop |
| Quality and accessibility | Core logic, browser flows and automated accessibility checks tested | Specialist accessibility audit, UAT, UI structure |

## 2. Identity and authentication

**Have (Done):** OIDC authorization code with PKCE; no passwords stored; JWT checked for signature, issuer, audience and expiry against rotating keys; required authorization claims or access is denied; least-privilege service identities for intake, scanner, reconciler and notification provider; live streams close at token expiry; verified against a real Keycloak for all roles.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Signing algorithms pinned (RS256/ES256/PS256) on staff and customer guards; authorized-party (`azp`) check (`AUTH_ALLOWED_CLIENTS`) | MUST | Us |
| ✅ DONE (code, tests, console prompt) — Step-up authentication for sensitive actions using `auth_time`/`acr`; the bank must define the acr levels | MUST | Us + Bank IdP |
| Integrate and test against the bank's real IdP, including MFA and conditional access | MUST | Bank |
| ✅ Revocation via introspection DONE and verified live against Keycloak; token lifetimes to be agreed with the bank | MUST | Us + Bank |
| ✅ Central entitlement lookup DONE (`ENTITLEMENT_URL`); the bank supplies the service | SHOULD | Us + Bank |
| ✅ Silent token renewal DONE in both apps; backend-for-frontend with HTTP-only cookies remains optional | SHOULD | Us |
| Service clients authenticate with mTLS or signed JWTs instead of shared secrets: configured at the bank's IdP; the API accepts the resulting tokens (no code change) | SHOULD | Bank |
| Idle timeout and concurrent-session policy (usually enforced at the IdP) | SHOULD | Bank |
| ✅ DONE — Start-up guard refuses production with development identity providers, secrets or missing hardening; the demo realm must still never be deployed | MUST | Us |

## 3. Authorization and data protection

**Have (Done):** default-deny roles; branch, queue, legal-entity, country and sensitivity scoping on every read and write; maker-checker with self-approval denied; masked references with audited reveal; administrator has configuration rights but no case access; opaque references and minimized events; per-subscriber filtering of live events; communication block against tipping-off; formula-injection-safe exports.

| Item | Priority | Owner |
|---|---|---|
| Entitlement model review with the bank (roles, queues, restricted data rules) | MUST | Bank + Us |
| Encryption in transit everywhere (TLS at ingress; TLS on database, Redis, bus, storage connections) and at rest (database, backups, object store with KMS) | MUST | Bank |
| Secrets from the bank's vault; no secrets in values files or images | MUST | Bank |
| Field-level protection for the most sensitive columns if the bank requires it | OPTIONAL | Us |
| Data classification labels aligned to the bank's scheme | SHOULD | Bank |

## 4. Audit trail

**Have (Done):** written in the same transaction as each change; append-only database trigger; SHA-256 hash chain that includes timestamps; hourly incremental and daily full verification; daily anchors published outside the database (event bus, optional object storage); alert metrics; scoped auditor search; views, exports and searches are themselves audited; list views audited. Tests prove detection of timestamp edits, mid-chain deletion and tail truncation.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Restricted runtime database user (`infra/postgres/roles.sql`) proven by test; start-up check and refuse-to-start option; the bank must deploy with these two accounts | MUST | Us |
| ✅ Streaming DONE (`AUDIT_STREAM_ENABLED`, via the outbox); the bank connects its SIEM to the topic | MUST | Us + Bank |
| Send anchors to storage the database admins cannot alter (Object Lock or SIEM) and alert on `audit_chain_valid` and `audit_runtime_role_safe` (metrics exist) | MUST | Bank |
| ✅ DONE — Before and after values for ticket edits, assignments, retention changes and every configuration change (free text recorded by fingerprint only) | MUST | Us |
| ✅ DONE — Source IP, user agent, token ID and authentication level on every audit event | SHOULD | Us |
| Audit failed validations and denied non-ticket requests (gateway/IdP cover failed logins) | SHOULD | Us + Bank |
| ✅ Ed25519 signed anchors DONE; swap the signer module for the bank's KMS/HSM if required | SHOULD | Us + Bank |
| ✅ DONE — Verified archival procedure with chain rebasing (`scripts/archive-audit.mjs`); the bank sets retention periods and stores archives in write-once storage | MUST | Us + Bank |
| Database activity monitoring for DBAs (pgaudit or the bank's tool) | MUST | Bank |
| Tested restore followed by a full chain verification (procedure documented in log entry 19) | MUST | Bank |
| Reduce the single global audit write lock (partitioned chains) | OPTIONAL | Us |
| Events written before hash version 2 are link-checked only; staff-typed reasons in metadata cannot be removed | Accept and document | Us |

## 5. Case management core

**Have (Done):** create, view, search, edit, assign; masked references; internal and customer notes; linked tickets; idempotent creation; lifecycle with per-category workflows; attachments (see section 11); retention and legal holds.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Optimistic concurrency (`expectedUpdatedAt`, 409 `stale_ticket`) on edit, assign and status change; console handles it | SHOULD | Us |
| ✅ Keyset pagination and index DONE for the ticket list (search stays bounded); index behaviour under production volumes still to be confirmed by load test | MUST | Us |
| Bulk actions, saved views, and richer search fields (only if the bank asks) | OPTIONAL | Us |
| Customer and account lookup through the bank's systems instead of opaque references typed by staff | MUST for real use | Bank |

## 6. Workflow and automation

**Have (Done):** per-category workflows stored as data with validation (no stuck states); role-gated transitions; auto-assignment (least-loaded, round-robin); SLA timers; escalation with once-per-rule idempotency; multi-instance safe scheduler.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Business-hours SLA calendars and pause while waiting on the customer (regulatory clocks are never paused); the bank confirms its hours and holidays | SHOULD | Us + Bank |
| Skills, shifts and absence in assignment | SHOULD | Us |
| BPMN engine adapter (Camunda or equivalent) if the bank mandates one; the event contract already supports it | OPTIONAL (bank decision) | Us + Bank |
| Graphical workflow editor (today it is a JSON text box) | OPTIONAL | Us |
| Guards beyond roles (approval required before resolve, per-state timers) | SHOULD | Us |

## 7. Australian compliance

**Have (Done, not specialist-reviewed):** complaint profiles as data (RG 271 defaults: acknowledge in one business day, final response in 30 days, 21 for hardship); business-day maths with holidays; IDR outcome on resolve; external dispute scheme tracking; vulnerable-customer and systemic flags; tipping-off communication block; complaints register; subject-access export; opt-in retention de-identification with legal holds.

| Item | Priority | Owner |
|---|---|---|
| Review by the bank's compliance team of clocks, outcomes, register fields and wording | MUST | Bank |
| Written retention schedules approved before enabling enforcement | MUST | Bank |
| ✅ DONE — Request-to-correct workflow (APP 13) on the same regulatory clock, with its own outcomes, portal entry and reporting | SHOULD | Us |
| Cut-off times and clock-pause rules where the regulator allows them | SHOULD | Bank + Us |
| Notifiable-data-breach and incident procedures supported by audit evidence | MUST | Bank |
| CPS 230 evidence pack: critical-operation tolerances, third-party register, exit plan | MUST | Bank |
| Data residency confirmation for every component (including backups and SaaS dependencies) | MUST | Bank |

## 8. Notifications and customer communications

**Have (Done):** governed customer communications (templates with bodies, optional second-person approval, masked recipients, communication block); minimized events at each state; SMTP/SMS delivery worker with leasing, backoff and receipts; contact-resolver seam; staff notification inbox with live push. Verified against a real mail server.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Email delivery worker: template subjects and bodies, send, record delivery, retry (verified against a real mail server) | MUST | Us |
| ✅ Adapter seam DONE (HTTP lookup `CRM_CONTACT_URL`); the bank must supply the real CRM endpoint | MUST | Bank + Us |
| ✅ HTTP SMS gateway adapter DONE; the bank must supply the gateway and credentials | MUST if SMS is in scope | Bank |
| ✅ DONE — Staff notifications: assignment, approval waiting, SLA or regulatory risk, escalation, customer reply; in-app inbox with per-person unread state and live push | SHOULD | Us |
| Staff email or push for important alerts, user preferences, quiet hours | OPTIONAL | Us |
| ✅ Template wording stored per template with an editor and live preview (placeholder-restricted); versions and localisation still to do | SHOULD | Us |
| ✅ Delivery metrics DONE (`communications{status}`); alert rules are the bank's | SHOULD | Us |

## 9. Intake channels and customer portal

**Have:** one idempotent intake endpoint under a least-privilege service identity, channel defaults managed by administrators, a message-ID ledger, and a simulator. Email, portal, mobile, phone and internal tickets enter the same SLA, assignment, audit and event path.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Real email intake: mailbox reader, sender-verified reply threading, auto-reply and loop protection, per-sender limits, pseudonymous senders (verified against a real mail server); needs the bank's mailbox | MUST for email | Us + Bank mailbox |
| ✅ DONE — Customer portal with its own login (separate realm/audience): raise a request or complaint, see own requests, read customer-visible updates, reply (verified; accessibility audit still to do) | MUST for self-service | Us + Bank |
| Plug the portal into the bank's online-banking login instead of a separate account | SHOULD | Bank |
| Customer attachments, with scanning | SHOULD | Us |
| Mobile app, using the same customer API | OPTIONAL | Bank |
| Phone/CTI integration (screen-pop, call ID on the ticket) | OPTIONAL | Bank |
| Identity verification of the customer | Bank process | Bank |

## 10. Integrations and events

**Have:** transactional outbox with row-locked claiming, retries, dead-letter and crash recovery; pluggable publishers; **Kafka publisher verified against a real broker** (keyed by ticket, envelope with event ID for de-duplication); receipts ledger for external systems; audit anchors published as events.

| Item | Priority | Owner |
|---|---|---|
| ✅ Publisher verified against a real Kafka-compatible broker; the bank must supply its bus, topics, schemas and security (mTLS/SASL) | MUST | Bank |
| ✅ Event catalogue generated from code with compatibility rules (`docs/events.md`); a schema registry is the bank's choice | SHOULD | Us + Bank |
| ✅ DONE — Dead-letter visibility, replay (audited) and admin screen; metric exists for alerting | MUST | Us |
| Adapters to core banking, CRM, cards, payments, KYC, fraud, document management (controlled APIs only) | MUST (scope per pilot) | Bank + Us |
| Reconciliation process and ownership | MUST | Bank |

## 11. Attachments and storage

**Have (Done, verified against an S3-compatible store and ClamAV):** direct browser upload by signed URL, uploader checksum verified by the scanner, scan gate, download only after a clean scan, EICAR test virus blocked, checksum mismatch refused, files never stored on local disk, retention deletes files.

| Item | Priority | Owner |
|---|---|---|
| Production bucket with default KMS encryption, versioning, Object Lock where required, no public access | MUST | Bank |
| ✅ Scan flow verified with ClamAV (EICAR blocked); the bank must provide the production scanner and signature process | MUST | Bank |
| Size, type and content-sniffing policy confirmed with security | SHOULD | Bank + Us |
| ✅ DONE — Downloads stay blocked while unscanned (outage = quarantine); `attachments_oldest_pending_scan_seconds` metric for alerting; scanner capacity is the bank's | SHOULD | Us |

## 12. Reporting and analytics

**Have (Done):** supervisor and auditor dashboard (workload, ageing, overdue, on-time rates, first-response times, root causes, channels, escalations, open complaints), complaints register export, audit search and export, operational metrics.

| Item | Priority | Owner |
|---|---|---|
| ✅ DONE — Weekly trends and breakdowns by category, branch and queue (monthly view not built) | SHOULD | Us |
| ✅ DONE — Daily scoped CSV exports to object storage | SHOULD | Us |
| ✅ DONE — Read-only `reporting` schema and `case_reporting` account; the bank connects its BI tool | SHOULD | Us + Bank |
| Dashboards in the bank's BI tool | Bank | Bank |
| A built-in analytics engine or predictive analytics | Not recommended | |

## 13. Platform, operations and resilience

**Have:** hardened containers (non-root, read-only filesystem, no capabilities); Helm chart with autoscaling, disruption budget, network policies, migration hook; one-command local stack; health probes; Prometheus metrics (token protected); structured logs with credentials redacted; security headers, rate limiting, request limits. Verified locally in Docker; the chart was rendered and linted only.

| Item | Priority | Owner |
|---|---|---|
| Install and test the Helm chart on a real cluster (OpenShift or Kubernetes) | MUST | Bank + Us |
| Tighten network policies to the actual database, IdP, bus and storage addresses | MUST | Bank |
| High-availability PostgreSQL with point-in-time recovery; agreed RPO and RTO | MUST | Bank |
| Disaster-recovery exercise with measured results (plan and procedure written: `docs/disaster-recovery.md`; the exercise itself is the bank's) | MUST | Bank + Us |
| ✅ Repeatable load test and baseline DONE (`loadtest/`, `docs/capacity.md`); tests against the bank's volumes and infrastructure still required | MUST | Us + Bank |
| ✅ Alert rules DONE (`deploy/monitoring/alert-rules.yaml`, validated, shipped as a PrometheusRule); the bank wires them to its alerting and builds dashboards | MUST | Us + Bank |
| ✅ Runbooks DONE (`docs/runbooks.md`); on-call ownership and the bank's incident and change process remain the bank's | MUST | Bank + Us |
| Distributed tracing and log shipping to the bank's tools | SHOULD | Bank |
| Shared (cluster-wide) rate limiting at the gateway | SHOULD | Bank |
| Zero-downtime upgrade and rollback rehearsal | SHOULD | Us |
| ✅ DONE — Capacity plan with measured storage growth and sizing guidance (`docs/capacity.md`) | SHOULD | Us |
| Typed database access (generated row types) to catch schema mistakes at compile time | OPTIONAL | Us |

## 14. Security assurance

**Have:** CI workflows written for dependency audit, CodeQL, image scanning, SBOM and secret scanning (not yet run on GitHub); zero known high or critical dependency findings at last check; threat model and control mapping drafted.

| Item | Priority | Owner |
|---|---|---|
| Run the security workflows in the real repository and fix findings | MUST | Us |
| Threat-model workshop with the bank's security team | MUST | Bank + Us |
| Independent penetration test and remediation | MUST | Third party |
| DAST against a staging environment | MUST | Third party |
| Code review by the bank or an assessor; secure-development evidence | SHOULD | Third party |
| Security sign-off, privacy impact assessment | MUST | Bank |
| ✅ Base images pinned by digest, Dependabot for weekly updates, SBOM generated in CI; image signing and SBOM retention are the bank's pipeline | SHOULD | Us |

## 15. Quality, usability and accessibility

**Have:** unit, end-to-end and database integration tests covering the controls that matter most (authorization, idempotency, audit integrity, escalation, retention, storage and scanning, Kafka); lint and builds clean. Tests were deliberately kept few.

| Item | Priority | Owner |
|---|---|---|
| ✅ Automated browser tests DONE for the main flows and screens of every role (`e2e/`); found and fixed a broken create form and others. Exploratory testing of the remaining screens and usability review still to do | MUST | Us |
| Automated WCAG 2.1 A/AA checks pass on all main screens (serious/critical gate); a specialist audit with assistive technology is still required | MUST | Third party + Us |
| ✅ DONE — Main screen split into a shell, hooks and components; behaviour verified by the browser tests | SHOULD | Us |
| Wider automated tests (UI end-to-end, permission matrix, regression) | SHOULD | Us |
| User acceptance testing with real operators | MUST | Bank |
| Localisation, if needed | OPTIONAL | Us |
| ✅ User guides by role DONE (`docs/user-guide.md`); the bank adds its own training material | SHOULD | Bank + Us |

## 16. Consolidated go-live gate (all MUST items)

Go-live requires every MUST above. In summary:

1. Authentication hardening done and the bank IdP integrated and tested, with step-up on sensitive actions.
2. Audit: restricted database user, continuous SIEM streaming, immutable anchor destination, before/after values, archival design, tested restore and verification.
3. Real delivery of customer email (and SMS if in scope) with contact lookup through the bank's systems.
4. Real intake channels in scope (email, portal) working with the bank's mailbox and login.
5. Event bus connected, dead-letter handling and reconciliation in place, adapters for the pilot's source systems.
6. Production storage and scanner configured.
7. Helm chart installed on a real cluster, network policies tightened, HA database, disaster-recovery exercise, load tests, alerts and runbooks.
8. CI security workflows green, threat model reviewed, penetration test and DAST remediated.
9. Browser-tested UI, accessibility audit, user acceptance testing.
10. Compliance review of complaint handling, approved retention schedules, CPS 230 evidence, data residency confirmed, privacy and security sign-off.

## 17. Suggested order of work

| Step | What | Mostly depends on |
|---|---|---|
| 1 | Finish email delivery and intake, staff notifications, customer portal | Us (after local container capacity is restored) |
| 2 | Authentication hardening (algorithm pinning, `azp`, step-up, revocation story, signed-JWT service clients) | Us |
| 3 | Audit hardening (restricted DB user, SIEM streaming, before/after, actor context, signed anchors, archival design) | Us |
| 4 | Dead-letter tooling, optimistic concurrency, pagination, trends and exports | Us |
| 5 | Browser testing, UI restructure, accessibility fixes | Us, then a third-party audit |
| 6 | Live-cluster install, DR, load tests, alerts, runbooks | Bank environment |
| 7 | Security assessment, compliance review, UAT, sign-off | Bank and third parties |

## 18. What is not recommended

- Microservices: the single-database, single-transaction design underpins the audit chain, the outbox and idempotency.
- A built-in analytics engine: feed the bank's BI platform instead.
- Shipping with the development identity realm, demo passwords or demo secrets in any shared environment.
- Enabling retention enforcement before the bank has approved retention schedules.
