# Code-level “How did you implement it?” playbook

[Interview index](README.md) · [Module answer starters](module-answers.md) · [NestJS course](../learn-nestjs/README.md)

The confusing part of “How did you implement it?” is that the interviewer is usually not asking for a technology list. They are testing whether you can move from requirement to runtime code, explain safety under failure/concurrency, and distinguish what you personally know from what a framework supplies.

## The answer ladder

Give the shortest useful answer first, then descend when asked.

### Level 1: 20–30 second map

```text
entry point -> identity/input boundary -> service decision
-> transaction/external effect -> frontend result -> proof
```

Example:

> A guarded Nest controller accepts a validated DTO and passes verified user context to the ticket service. The service loads current ticket state, applies resource policy and writes the mutation, audit event and outbox row through one PostgreSQL transaction. React Query refetches after success or stale conflict. Unit, HTTP E2E and database integration tests prove the policy, boundary and atomicity separately.

Stop there and let the interviewer choose the branch.

### Level 2: two-minute implementation

Name concrete files/classes/methods and one failure:

```text
component/API function
controller method + DTO/guard
service method + policy
tables + lock/idempotency/transaction
audit/outbox/worker
query invalidation/error code
test + limitation
```

### Level 3: code/whiteboard

Write a small skeleton, not an entire repository. Explain each line and the guarantee it creates. Use exact SQL when concurrency is the question.

## Seven questions every answer should cover

1. **Entry:** What user action, route, worker or callback begins it?
2. **Trust:** Which input is untrusted, and how is identity established?
3. **Decision:** Which provider owns permission/current-state/business rules?
4. **Persistence:** What tables change and which writes share a transaction client?
5. **Concurrency/retry:** Which lock, version, unique key, lease or idempotency key resolves overlap?
6. **Propagation:** What audit, outbox, notification/live event or frontend cache effect follows?
7. **Proof:** Which test proves the strongest claim, and what limitation remains?

If you miss question 5, the answer often sounds tutorial-level rather than production-level.

## Replace vague statements with executable ones

| Avoid | Say instead |
|---|---|
| “We used JWT.” | “`AuthGuard.canActivate` verifies JWKS signature, issuer, audience, an asymmetric algorithm allow-list, expiry and optional client/revocation, then stores an allow-listed `UserContext` on the Fastify request.” |
| “We used RBAC.” | “`PolicyService` first checks operation permission, then current ticket entity/country/queue/branch/assignment/sensitivity; maker-checker and step-up add action-specific controls.” |
| “We used transactions.” | “`PgService.transaction` passes one `PoolClient`; ticket update, audit append and outbox insert all use that client, so an audit failure rolls back the business row.” |
| “We handled concurrency.” | “The outbox claim uses `FOR UPDATE SKIP LOCKED`; ticket edits currently compare a timestamp non-atomically, so I would use a conditional version update and prove one winner with two clients.” |
| “We used React Query.” | “`useTicketMutation` calls the typed API function, refreshes the ticket/list after commit, refetches on 409, and preserves the form until success.” |
| “We tested it.” | “A policy unit proves refusal branches, Fastify-injected E2E proves guard/DTO/status wiring, and real PostgreSQL integration proves constraints/rollback.” |

## Full example 1: authentication

### 30-second answer

> The staff React app uses OIDC Authorization Code with PKCE and never handles passwords. It sends the access token only in the Authorization header. Nest's `AuthGuard` verifies the token against JWKS with issuer, audience and algorithm checks, optionally checks client/revocation/current entitlements, normalizes known roles/scope into `request.user`, and services use that with current resource data for authorization.

### Code-level expansion

```text
apps/web/src/auth.ts
  UserManager.signinRedirect -> code + PKCE -> signinCallback
apps/web/src/session/session-provider.tsx
  recover/renew/expire user -> GET /me
apps/web/src/api.ts
  Authorization: Bearer + X-Correlation-Id
apps/api/src/auth/auth.guard.ts
  ExecutionContext -> FastifyRequest
  jwtVerify(token, remoteJWKSet, issuer/audience/algorithms)
  assertAllowedClient -> assertTokenActive -> lookupEntitlements
  toUserContext -> request.user
service
  PolicyService(current identity + current ticket)
```

Failure details:

- malformed/untrusted identity is 401 before DTO/controller;
- valid identity lacking resource access is 403 in the service;
- coded step-up 403 asks for recent/strong login without treating identity as absent;
- introspection/entitlement caches create bounded change latency;
- the SSE stream ends at token expiry.

Proof:

- generated RSA pair + local JWKS verifies real cryptography;
- hardening tests cover algorithm/client/revocation/entitlement/step-up;
- Nest E2E proves `/me` is guarded;
- browser/system test is still needed for the deployed IdP redirect.

## Full example 2: ticket status change

### Whiteboard path

```text
ChangeStatusModal
-> api.transitionTicket(expectedUpdatedAt)
-> AuthGuard
-> ValidationPipe(TransitionTicketDto)
-> TicketsController.transition
-> TicketsService.transition
     -> load ticket
     -> PolicyService ticket:update
     -> redaction/stale/workflow/root-cause/outcome checks
     -> history + ticket/SLA update
     -> AuditService.write(same client)
     -> OutboxService.enqueue(same client)
     -> LiveEventsService.notify(same client)
     -> optional ResolutionNoticeService
-> commit
-> React Query refresh + SSE hints other clients
```

### Code skeleton

```ts
return db.transaction(async (client) => {
  const ticket = await loadTicket(client, id);
  policy.assertTicketAccess(user, ticket, 'ticket:update');
  await workflow.assertTransition(client, ticket.category, ticket.status, dto.toStatus, user.roles);
  const updated = await updateTicket(client, ticket, dto);
  await audit.write(client, eventFor(user, ticket, updated, correlationId));
  await outbox.enqueue(client, eventMessage(updated, correlationId));
  await live.notify(client, 'ticket.status_changed', updated);
  return project(updated);
});
```

The most valuable caveat:

> The current `expectedUpdatedAt` comparison is not an atomic optimistic lock because the read is not `FOR UPDATE` and the update does not include the expected value. I would change it to `UPDATE ... WHERE id=$1 AND version=$expected RETURNING` and return `stale_ticket` when no row is updated.

That caveat shows you read the code rather than memorized an ideal design.

## Full example 3: audit

### Answer structure

1. A service has verified actor and correlation id.
2. The business transaction changes state.
3. It calls `AuditService.write` with the same `PoolClient`.
4. Audit takes an advisory transaction lock, reads previous head and hashes the exact stored v2 representation.
5. It inserts append-only evidence and optionally a SIEM outbox event.
6. The runtime database role cannot update/delete/truncate/own the table.
7. scheduled verification recomputes links/content and checks signed/external anchors.
8. audit search is itself scoped and audited; export requires step-up.

Clarify two different failure policies:

- success audit failure rolls back the business mutation;
- denied-authorization audit is a separate best-effort transaction that preserves the original 403.

## Full example 4: frontend implementation

Do not end with “then the frontend calls the API.” Name the state path:

```text
route/page
-> session capability hides/shows affordance
-> controlled form and pending state
-> typed api.ts function through shared request helper
-> useMutation
-> on success refresh exact query keys and clear form
-> on 409 preserve draft + refetch authoritative ticket
-> on 401 session recovery; coded step-up offers reauth
-> SSE invalidates/refetches, never inserts partial event as truth
```

Security statement:

> The capability check is presentation only. The API guard and service repeat identity, permission, resource scope and state checks because browser code and cached roles are caller-controlled/stale.

## How to answer follow-up branches

### “Why did you put that in the service?”

Because controllers/workers/providers can enter the same use case. The service owns current resource policy, state and transaction invariants; the controller owns HTTP extraction.

### “What happens when two requests arrive together?”

Name the exact primitive. If there is none, say so. Good answers sound like:

> Both can reach the precondition. The unique `(ticket_id, actor_id)` constraint lets one insert and the other maps SQLSTATE 23505 for that named constraint to 409.

or:

> Rows are claimed in a short transaction with `FOR UPDATE SKIP LOCKED`, so workers receive disjoint batches. Publish occurs after commit, so a publish-before-mark crash can duplicate; consumers deduplicate by event id.

### “What if the dependency is down?”

Classify it:

- security/evidence critical: fail closed or roll back;
- optional worker: stay disabled or persist retry;
- cache: fail open to authoritative database;
- live hint: committed state remains correct; reconnect/resync;
- external delivery: lease/retry/dead-letter, at least once.

### “How did you test that?”

Tie the test to the claim:

```text
pure branch -> unit
Nest route/guard/DTO/status -> HTTP E2E
SQL constraint/lock/rollback/privilege -> real PostgreSQL integration
broker/storage/IdP protocol -> external integration/system
React cache/form/accessibility -> frontend hook/component/browser
```

## Recovery when you forget code in the interview

Do not invent a method name. Recover with the architecture:

> I do not remember the exact helper name, but the invariant is that the service passes the transaction's `PoolClient` to both the business insert and `AuditService.write`; otherwise rollback would not be atomic. I would open the ticket service and audit writer to confirm the method name.

This is better than bluffing. Then continue with the data flow you do know.

## How to discuss limitations professionally

Use four parts:

```text
Current guarantee
-> exact gap
-> concrete fix
-> proof/rollout
```

Example:

> Today the stale timestamp detects an edit that happened before the request loaded, but two simultaneous requests can both pass because the read/check/update is not atomic. I would add an integer version and conditional update, map zero rows to 409, preserve the user's draft in React, and add a two-connection barrier test before rollout.

Do not say “there are no race conditions.” Do not list weaknesses without a bounded fix.

## Practice cards

For each topic, speak for 30 seconds, two minutes, then draw code/SQL:

1. staff login and token verification;
2. ticket creation and idempotency;
3. status transition and stale update;
4. audit append and integrity verification;
5. outbox crash windows;
6. attachment direct upload and scan;
7. communication maker-checker and delivery receipt;
8. portal ownership and customer reply;
9. dashboard scope-safe aggregates;
10. React Query mutation and SSE convergence.

Score yourself:

| Score | Evidence |
|---:|---|
| 0 | technology names only |
| 1 | route/class names, no state/failure explanation |
| 2 | service and transaction path |
| 3 | concurrency/idempotency and frontend recovery |
| 4 | tests tied to guarantees plus honest limitation/fix |

## Final reusable template

```text
The requirement was ______________________________.

The entry point is _______________________________.
Identity/input is established by _________________;
we do not trust _________________________________ .

The controller/worker delegates to ______________.
That provider loads _____________________________,
checks __________________________________________,
then writes _____________________________________
inside __________________________________________.

Concurrent/retried requests are handled by ______.
After commit, ___________________________________.
The frontend ____________________________________.

If __________________ fails, _____________________.
I prove the pure rule with ______________________,
the HTTP boundary with __________________________,
and the persistence/concurrency guarantee with __.

The current limitation is _______________________,
and I would fix/prove it by ______________________.
```

Use the [module answer starters](module-answers.md) to fill this template for every module, and the [cross-module maps](../modules/reference/README.md) when the follow-up crosses wiring, persistence and frontend behavior.
