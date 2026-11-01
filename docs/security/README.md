# Security documentation

The security **design evidence** for a bank review lives here. The **implementation** of each control lives in its topic folder.

| Document | Contents |
|---|---|
| [Security pack](security-pack.md) | Assets, trust boundaries, STRIDE threats and controls, APRA CPS 234 and Privacy Act mapping, known gaps |

## Where each control is implemented

| Control | Topic |
|---|---|
| Authentication (OIDC, JWT, JWKS, PKCE, step-up) | [Auth](../auth/README.md) |
| Authorization (RBAC + ABAC, maker-checker) and the roles matrix | [Auth → policy](../auth/authorization-policy.md), [roles and access](../auth/roles-and-access.md) |
| Tamper-evident audit, append-only DB, anchors | [Audit](../audit/README.md) |
| Least-privilege database roles | [Audit → database protection](../audit/database-protection.md) |
| Malware scanning, presigned URLs, capability links | [Attachments](../attachments/README.md) |
| Tipping-off control, privacy exports, CSV safety | [Compliance](../compliance/README.md) |
| Retention and de-identification | [Retention](../retention/README.md) |
| HTTP hardening (Helmet, CORS, rate limit, body limit, validation) | [API bootstrap](../api-bootstrap/bootstrap-and-modules.md) |
| Production safety gate | [Auth → token hardening](../auth/token-hardening.md#5-production-safety-gate) |
| Data minimisation in events, metrics and logs | [Outbox](../outbox/README.md), [Observability](../observability/README.md) |

The API is the security authority. Frontend role checks only control navigation and button visibility; every API request is independently authenticated and authorized.
