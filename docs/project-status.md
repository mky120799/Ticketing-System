# Project status

Plain-language summary of what is built and what is not. "Done" means built and tested locally (PostgreSQL 18, Docker, real Keycloak). "Partly" means built with a known gap. Last updated 2026-10-03 (audit trail completed).

## Achieved

### Core case handling
| Capability | Status |
|---|---|
| Login through an identity provider (no passwords stored in the app) | Done |
| Roles and permissions (branch agent, call-centre agent, case agent, supervisor, auditor, administrator); users see only their own queues, branch, legal entity and country | Done |
| Create, view, search, edit, assign tickets | Done |
| Customer references masked; revealing one is a separate, logged action | Done |
| Internal and customer notes; lifecycle status changes | Done |
| Linked tickets (duplicate, related, parent) | Done |
| Attachments: direct upload, checksum, malware-scan gate, gated download | Partly: no real storage or scanner connected |
| Customer communications from approved templates with a second-person approval | Done; nothing actually sends yet |
| Safe re-submission (the same request never creates two tickets) | Done |

### Automation
| Capability | Status |
|---|---|
| Auto-assignment (least-loaded or round-robin) by configurable rules | Done |
| SLA timers for first response and resolution | Done |
| Escalation of overdue tickets to another queue, once per rule | Done |
| Live updates to everyone entitled to see a ticket | Done |
| Per-category workflows editable by an administrator | Done |

### Australian compliance (configuration, not hard-coded)
| Capability | Status |
|---|---|
| Complaint handling with ASIC RG 271 clocks (acknowledge in 1 business day, final response in 30 days) | Done; not reviewed by a compliance specialist |
| Business-day maths with public holidays | Done |
| Complaint outcome required to resolve; external dispute scheme (AFCA) tracking; vulnerable-customer and systemic-issue flags | Done |
| Communication block against tipping-off (default on fraud cases) | Done |
| Complaints register export (CSV, formula-injection safe) | Done |
| Subject-access export (APP 12) | Done |
| Retention: de-identify expired closed tickets, honour legal holds | Done; off by default |

### Reporting and operations
| Capability | Status |
|---|---|
| Dashboard: workload, ageing, overdue, on-time rates, root causes, channels, open complaints | Done |
| Intake from email, portal, mobile, phone, internal (one endpoint plus simulator) | Partly: no real email or portal connection |
| Operator screens for all of the above | Done; not clicked through in a real browser |
| Metrics endpoint for monitoring (token-protected) | Done |

### Security and delivery
| Capability | Status |
|---|---|
| Security headers, rate limiting, request-size limits | Done |
| Hardened containers, Helm chart, one-command local setup | Done; chart not installed on a live cluster |
| CI: tests, dependency audit, code scanning, image scanning, secret scanning | Written; not yet run on GitHub |
| Documentation: architecture, deployment, security pack, bank onboarding, implementation log | Done |
| Audit trail: append-only, hash chain including timestamps, hourly and daily verification, published anchors, auditor search, list views audited, alert metrics | Done; legacy events are link-checked only; see log entry 14 for limits |

## Not achieved

### Needs the bank's systems
- Bank identity provider and API gateway
- A workflow engine such as Camunda (workflows work without one)
- A running event bus (Kafka); the publisher is written but untested against a broker
- Real object storage and malware scanning
- Core banking, CRM, cards, KYC and fraud integrations
- Real email and SMS sending
- Customer portal and mobile app, including customer login
- SIEM and tracing connections

### Needs people and time
- Penetration test and threat-model workshop with the bank
- Accessibility audit (WCAG 2.1 AA)
- Load, performance and disaster-recovery testing
- Compliance review of the complaint rules
- Bank-approved retention schedules before enabling retention
- Helm chart installed on a real cluster

### Known gaps in what was built
- No workflow for correcting customer data (APP 13)
- Workflow editor is a JSON text box
- UI never tested in a real browser; the main screen file is large and dense
- Few automated tests by design (features were prioritised)
- Rate limiting is per server instance
- Dev-realm demo logins must never reach a shared environment
