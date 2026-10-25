# Security documentation

- [Security pack](security-pack.md) — threat model, controls and known gaps.
- [Roles and access](roles-and-access.md) — permissions, scope, sensitivity and maker-checker rules.
- [Authentication module](../modules/authentication/README.md) — implementation-level identity flow.
- [Authorization module](../modules/authorization.md) — code-level policy evaluation.
- [Audit module](../modules/audit/README.md) — tamper-evident evidence and verification.

The API is the security authority. Frontend role checks only control navigation and button visibility; every API request is independently authenticated and authorized.
