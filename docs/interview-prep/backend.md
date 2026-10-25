# Backend interview answers

Use these quick answers after practicing the full [code-level answer playbook](code-level-answer-playbook.md).

## “How did you implement authentication?”

Start at `apps/web/src/auth.ts` for PKCE, then `apps/web/src/api.ts` for Bearer headers, then `apps/api/src/auth/auth.guard.ts` for JWKS JWT validation, issuer/audience/algorithm checks, optional revocation/entitlements, and `UserContext`. Explain that authorization is deliberately later in `PolicyService` because resource scope requires the database row.

## “How did you implement authorization?”

Point to `policy.service.ts`: permission first, then entity/country, queue, branch/ownership, sensitivity and extra step-up/maker-checker/workflow checks. Explain that frontend buttons only improve UX and that services repeat the decision.

## “How did you implement audit?”

Point to a service transaction in `tickets.service.ts`, `AuditService.write`, `audit-hash.ts`, the append-only trigger, restricted database role and `AuditIntegrityService`. Explain that the same `PoolClient` commits the business row, audit row and outbox event together; the hash chain detects edits and external anchors detect truncation.

## “What happens when authorization fails?”

The policy throws 403 inside the service transaction. `DeniedAuthorizationInterceptor` catches the error stream, writes `authorization.denied` in a separate transaction, then rethrows the original 403.

## “How do you prove it works?”

Mention guard tests with real signed JWTs, policy unit tests, HTTP E2E tests, integration tests for database roles and transaction behavior, and production-safety tests.
