# Project status

Plain-language summary of what is built and what is not. "Done" means built and tested (unit, integration against live services, and browser tests). Last updated 2026-10-03. For the full, prioritised list of what a production go-live still needs, see [`production-readiness.md`](production-readiness.md); for how each feature was built, [`implementation-log.md`](implementation-log.md).

## Achieved

### Case handling
| Capability | Status |
|---|---|
| Login through an identity provider (staff and, separately, customers); no passwords stored in the app | Done |
| Roles and permissions with branch, queue, legal-entity, country and sensitivity scoping; administrators have no case access | Done |
| Create, view, search, page through, edit, assign tickets; stale-edit protection | Done |
| Customer references masked; revealing one is a separate, step-up-protected, logged action | Done |
| Internal and customer notes; workflow-driven status changes; resolve needs a root cause | Done |
| Linked tickets; attachments with direct upload, checksum, ClamAV scanning (EICAR blocked) and gated download | Done |
| Customer communications from approved templates (editable wording), second-person approval, delivery by email and SMS gateway | Done (real SMS gateway and CRM lookup are the bank's) |
| Staff notification inbox with live push (assignment, approvals, deadlines, escalation, customer replies) | Done |
| Safe re-submission (idempotent creation and intake) | Done |

### Intake channels
| Channel | Status |
|---|---|
| Staff (branch, call centre, internal) | Done |
| Email: real mailbox reader, reply threading, auto-reply and loop protection, acknowledgement | Done (verified against a real mail server) |
| Customer portal with its own login: raise a request, complaint or correction request; follow progress; reply | Done |
| Mobile app, phone/CTI | Not built (the same intake endpoint is ready for them) |

### Automation and workflow
| Capability | Status |
|---|---|
| Auto-assignment (least-loaded or round-robin) by configurable rules | Done |
| SLA timers with business-hours calendars and pause-while-waiting-for-customer | Done |
| Escalation paths, once per rule, multi-instance safe | Done |
| Per-category workflows editable by an administrator, with safety validation | Done |
| Live updates to everyone entitled to see a change | Done |

### Australian compliance (configuration, not code)
| Capability | Status |
|---|---|
| Complaint handling with ASIC RG 271 clocks, business days and holidays | Done (not reviewed by a compliance specialist) |
| IDR outcome, external dispute scheme tracking, vulnerable-customer and systemic-issue flags | Done |
| Request to correct personal information (APP 13) on the same clock, with its own outcomes | Done |
| Communication block against tipping-off; complaints register export; subject-access export (APP 12) | Done |
| Retention: de-identify expired closed tickets, honouring legal holds | Done (off by default) |

### Audit and security
| Capability | Status |
|---|---|
| Append-only, hash-chained audit with timestamps in the hash, request context and before/after values | Done |
| Hourly and daily verification, signed external anchors, SIEM streaming, verified archival | Done |
| Application database account physically unable to alter the audit trail (proven by test) | Done |
| Auditor search and integrity console | Done |
| Pinned token algorithms, client allow-list, revocation by introspection, step-up, central entitlements, silent renewal | Done |
| Start-up guard refusing production with development settings | Done |
| Security headers, rate limiting, body limits, bounded database pool and timeouts | Done |

### Reporting and operations
| Capability | Status |
|---|---|
| Dashboard: workload, ageing, overdue, on-time rates, root causes, channels, complaints and privacy requests, weekly trends | Done |
| Read-only reporting schema and account for the bank's BI tools; daily scheduled report exports | Done |
| Prometheus metrics and 12 alert rules; dead-letter tooling; runbooks; capacity plan with measured baseline; disaster-recovery plan | Done |
| Event catalogue generated from code; Kafka publisher verified against a real broker | Done |
| Hardened containers (pinned digests), Helm chart, one-command local stack, CI security workflows (written) | Done (chart not installed on a live cluster; CI not yet run on a code host) |
| Browser tests with accessibility checks for every role | Done |

## Not achieved

### Needs the bank's environment, people or an assessor
- Bank identity provider, MFA, conditional access, API gateway; entitlement and customer-contact services
- Core banking, CRM, cards, payments, KYC, fraud and document-management adapters
- Production event bus, object storage with Object Lock and KMS, malware scanner fleet, SIEM, tracing
- Real SMS provider, the bank's online-banking login for the portal
- Helm chart on a real cluster, high-availability database, disaster-recovery exercise, load test at the bank's volumes
- Penetration test, DAST, threat-model workshop, specialist accessibility audit, compliance review, user acceptance testing, security and privacy sign-off

### Known gaps in what was built
- Skills, shift and absence-aware assignment; workflow guards beyond roles (for example approval before resolve)
- Customer attachments in the portal; mobile app; phone integration
- Template versioning and localisation; a graphical workflow editor (it is a JSON editor)
- Rate limiting is per server instance (the bank's gateway should also limit)
- Events written before audit version 2 are link-checked only; staff-typed reasons in audit metadata cannot be removed later
- A broader automated test suite (the controls that matter most are covered; most screens are covered only by the main browser flows)
- Dev-realm demo logins must never reach a shared environment (the start-up guard enforces this in production mode)
