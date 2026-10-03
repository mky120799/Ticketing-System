# Security pack

Design-level evidence for a bank security review. It is a starting point for the bank's own threat-modelling and control mapping, not a certification.

## 1. Scope and assets

Assets, highest sensitivity first: customer-linked case content (descriptions, notes), opaque customer/account references, attachments, communication recipients, the immutable audit trail, configuration (routing, regulatory profiles, workflows), and service credentials.

## 2. Trust boundaries and data flow

```text
 Staff browser ──TLS──▶ Ingress/WAF ──▶ Web console (static)         Channel adapters ──▶ Intake API (service identity)
        │                      │
        └── OIDC (PKCE) ◀──▶ Bank IdP                                   Object storage ◀── presigned URLs ── browser
        └── REST + SSE ───▶ API ──▶ PostgreSQL (authoritative, audit, outbox)
                              ├──▶ Redis (non-authoritative cache)
                              └──▶ Outbox ──▶ Event bus ──▶ downstream systems
```

Boundaries: internet/browser to ingress; ingress to API; API to database; API to IdP (JWKS); API to object storage and bus; adapters and scanners (separate service identities) to API.

## 3. Threats and controls (STRIDE)

| Threat | Example | Control in this product | Residual / bank action |
|---|---|---|---|
| Spoofing | Forged or replayed token | JWT verified for signature, issuer, audience, expiry (JWKS); no local passwords; SSE closes at token expiry; service roles narrowly scoped | Bank IdP MFA/conditional access; token lifetime policy |
| Tampering | Edit audit history | Append-only trigger; SHA-256 hash chain whose hash covers each event's timestamp; transactional writes; hourly and daily verification; daily anchors published outside the database | Point the anchor bucket at Object Lock / SIEM that DB admins cannot alter; alert on `audit_chain_valid` |
| Tampering | Duplicate or conflicting submissions | Idempotency keys with request fingerprints; intake message ledger; unique constraints on escalations | None |
| Repudiation | "I didn't approve that" | Every material action audited with actor and correlation ID; maker-checker with self-approval denied | SIEM forwarding of audit/log streams |
| Information disclosure | Cross-queue / cross-entity reads | Default-deny RBAC plus branch, queue, entity, country, sensitivity checks on every read; live events re-checked per subscriber | Entitlement design review per bank |
| Information disclosure | Customer data in logs/events/metrics | References masked by default (reveal is audited); outbox and push payloads are minimized to IDs; logs redact credentials; metrics have no customer labels | Log-pipeline review |
| Information disclosure | Malicious or leaked attachments | Direct-to-storage presigned URLs, KMS encryption setting, checksum, malware-scan state machine; download only when clean | Provision approved scanner; bucket policy |
| Denial of service | Request flooding, large bodies | Per-client rate limit, 1 MiB body cap, bounded live streams per user, bounded batch sizes | Gateway/WAF limits, autoscaling |
| Elevation of privilege | Admin reads case data | Administrator role has configuration only; supervisors cannot approve their own actions; service roles cannot read tickets | Quarterly access review |
| Tipping-off / investigation integrity | Customer notified of an investigation | Communication block (default on fraud cases) refuses customer-facing activity; reason held in audit only | Bank to define SMR handling procedures |
| CSV/formula injection | Malicious text exported to a spreadsheet | Register export neutralises leading `= + - @` | None |
| Data retention failure | Data kept past policy | Opt-in de-identification job honours legal holds, re-checks under lock | Bank-approved retention schedules |

## 4. Mapping to APRA CPS 234 (information security)

| CPS 234 theme | Where it is addressed |
|---|---|
| Roles and responsibilities | Role/permission model (`docs/architecture.md` section 2), separation of duties, service identities |
| Information security capability | Hardening (headers, rate limits), secure defaults, secret handling via existing Secret only |
| Policy framework | Configuration-as-data (workflows, regulatory profiles, retention) so policy changes are audited |
| Information asset identification and classification | Sensitivity levels, attachment classification, masked references |
| Implementation of controls | RBAC, encryption in transit (terminate TLS at ingress; DB/Redis TLS by connection string), object-store encryption, malware scan gate |
| Incident management | Audit trail, correlation IDs, dead-letter visibility via metrics; incident runbooks are a bank deliverable |
| Testing control effectiveness | CI: dependency audit, CodeQL, container scan, secret scan; penetration test and DAST are bank-run |
| Internal audit / notification | Auditor role, audit export; APRA notification process is a bank procedure |

CPS 230 (operational risk) evidence to assemble with the bank: tolerance levels for critical operations, tested restore, third-party (cloud, IdP, scanner, bus) dependency register, and the exit/continuity plan for this product.

## 5. Privacy Act and Australian Privacy Principles

Minimisation (opaque references, no customer data in events), purpose-limited access (queue/entity scoping), security (above), retention and destruction (APP 11.2: de-identification job, legal-hold aware), access (APP 12: `POST /v1/privacy/subject-access`, supervisor-only and audited; internal notes and blocked or de-identified cases are withheld for human review) and correction (APP 13: staff edit through normal case actions; no dedicated workflow yet), and notifiable data breaches (the audit trail supports investigation; the process is the bank's).

## 6. Secure development

CI runs lint, build, unit, e2e and database integration tests, `npm audit` (high/critical blocks), CodeQL, Trivy image scans with an SBOM, and secret scanning. Dependencies are pinned through the lockfile. Parameterised SQL only; interpolated SQL fragments come from fixed constants.

## 7. Known gaps (be upfront with the bank)

- No third-party penetration test, DAST, or threat-model workshop with the bank yet.
- No customer-portal identity (intake is a stub); no dedicated correction workflow.
- Rate limiting is per instance. Audit anchors protect against truncation only up to the last anchor; events written before audit version 2 are link-checked only.
- Accessibility (WCAG 2.1 AA) has not been audited.
- Kafka and real object storage have not been exercised.
- The dev realm contains demo credentials that must never reach a shared environment.
