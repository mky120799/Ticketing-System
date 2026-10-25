# Audit module

Audit answers: “What happened, who did it, to what, under which request, and can we prove the record was not altered?” It is separate from application logging and is written transactionally with material business changes.

## Code map

| Layer | Files | Responsibility |
|---|---|---|
| Request context | [request-context.ts](../../../apps/api/src/audit/request-context.ts) | Captures IP/user agent and later token facts with `AsyncLocalStorage` |
| Event writer | [audit.service.ts](../../../apps/api/src/audit/audit.service.ts) | Appends normalized, hashed events using the caller's transaction client |
| Canonical hash | [audit-hash.ts](../../../apps/api/src/audit/audit-hash.ts) | Stable JSON and SHA-256 hash chaining |
| Denied actions | [denied-authorization.interceptor.ts](../../../apps/api/src/audit/denied-authorization.interceptor.ts) | Records 403 decisions after the business transaction rolls back |
| Integrity | [audit-integrity.service.ts](../../../apps/api/src/audit/audit-integrity.service.ts) | Verifies links, hashes and anchors |
| Anchor signing | [anchor-signer.ts](../../../apps/api/src/audit/anchor-signer.ts) | Optional Ed25519 signatures |
| Audit API | [audit.controller.ts](../../../apps/api/src/audit/audit.controller.ts) | Search, reports, verification and anchor status |

Continue with [event model](event-model.md), [integrity and operations](integrity-and-operations.md), [frontend audit surfaces](frontend.md), and [audit testing](testing.md).

## What is guaranteed at each layer

| Layer | Guarantee |
|---|---|
| Service transaction | a successful material mutation and its audit event commit or roll back together |
| Event schema | actor, action, target, correlation, outcome and minimized metadata are explicit |
| Chain writer | an advisory transaction lock serializes the previous-head read and new append |
| Hash | version-2 digest covers normalized stored fields, timestamp and previous hash |
| Database privilege | runtime app role can append but cannot update/delete/truncate/own the audit table |
| Trigger | append-only protection also blocks forbidden changes, including owner truncate guard behavior |
| Verification | links and v2 content hashes are recomputed; checkpoints record result/failure sequence |
| Anchor | verified head is copied to outbox and optional externally retained/signed object |
| API policy | searches/reports are permission- and ticket/scope-filtered; export needs step-up |
| Frontend | renders evidence and integrity state; cannot mutate or manufacture history |

The hash chain is not a substitute for identity, authorization, transactions or database least privilege. It makes later alteration detectable when combined with trusted anchors and verification.

## Study this module in order

1. [Ticket change and audit flow](../../flows/ticket-change-and-audit.md) for atomic business evidence.
2. [Event model and transaction boundary](event-model.md) for canonical fields, minimization and denied actions.
3. [Integrity and operations](integrity-and-operations.md) for chaining, verification, anchors and archive continuity.
4. [Audit report flow](../../flows/audit-report.md) for scoped search, report, export and step-up.
5. [Frontend implementation](frontend.md) for query keys, display names and export behavior.
6. [Testing](testing.md) for rollback, tamper detection and restricted-role proof.

## Success versus denied evidence

Successful business evidence is strict: `AuditService.write(client, ...)` uses the caller's transaction client, so its failure rolls back the mutation. A denied 403 has no successful business transaction to join; `DeniedAuthorizationInterceptor` attempts a separate transaction and preserves the original 403 even if that evidence write fails. Authentication 401s occur before handler interceptors and require a separate edge telemetry design if retained.

## Code-level interview checklist

Be ready to explain:

```text
business service receives verified UserContext + correlation id
-> PgService.transaction obtains PoolClient
-> mutate business state
-> AuditService.write(same client)
-> pg_advisory_xact_lock serializes chain head
-> read previous event hash
-> merge minimized request context
-> compute v2 hash from exact stored representation
-> INSERT audit event
-> optional SIEM outbox enqueue with same client
-> COMMIT or full rollback
```

Then describe verification, anchor/signature checking, append-only database roles, scoped search and the limitation that audit proves what the application recorded—not that every upstream real-world assertion was true.
