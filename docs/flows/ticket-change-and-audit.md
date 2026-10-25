# Flow: ticket status change, evidence and frontend convergence

This trace follows a status change from the staff modal through authorization, workflow, PostgreSQL, audit, outbox, live hints and React Query. It also identifies a real optimistic-concurrency limitation in the current implementation.

## Runtime sequence

```text
ChangeStatusModal
  -> transitionTicket(api.ts)
  -> POST /v1/tickets/:ticketId/status
  -> AuthGuard
  -> global interceptors enter
  -> ValidationPipe creates TransitionTicketDto
  -> TicketsController.transition
  -> TicketsService.transition
       -> load current ticket
       -> PolicyService.assertTicketAccess(ticket:update)
       -> reject redacted/stale/illegal transition
       -> status history + SLA/regulatory fields
       -> ticket UPDATE
       -> AuditService.write
       -> OutboxService.enqueue
       -> LiveEventsService.notify
       -> optional resolution notice
  -> COMMIT
  -> mapped ticket response
  -> React Query refreshes ticket/list/dashboard state
```

## 1. Frontend builds the command

[`change-status-modal.tsx`](../../apps/web/src/features/ticket/change-status-modal.tsx) only offers `ticket.allowedNextStatuses`, which came from the server's workflow definition. Resolving requires root cause in the form; regulated complaint/privacy resolution also requests the relevant outcome.

The request includes:

- `toStatus` and reason;
- root cause/outcome when applicable;
- `expectedUpdatedAt` from the ticket the user last loaded;
- Bearer token and a fresh correlation id through the shared API client.

The frontend list is an affordance. A caller can alter it, so the backend recomputes every transition rule.

## 2. Nest boundaries run in order

For `POST /v1/tickets/:ticketId/status`:

1. Fastify parses/limits the request.
2. `AuthGuard` verifies identity and writes `request.user`/correlation context.
3. global interceptors enter.
4. `ValidationPipe` checks `TransitionTicketDto` vocabulary, reason bounds and timestamp shape.
5. `TicketsController.transition` forwards user, id, DTO and correlation id.

A missing token returns 401 before DTO details. An invalid authenticated DTO returns 400 before the service.

## 3. Service checks current authorization and state

Inside `PgService.transaction`, `TicketsService.transition` loads the ticket and calls:

```ts
this.policy.assertTicketAccess(user, ticket, 'ticket:update');
```

That combines role permission with queue/branch/entity/country/sensitivity/assignment rules using current ticket attributes. It then rejects a redacted ticket and compares `expectedUpdatedAt` when supplied.

`WorkflowDefinitionService.assertTransition` loads the active definition for category/status and confirms the target plus actor role. Resolving performs additional domain checks:

- root cause is mandatory;
- complaints/privacy requests need an allowed formal outcome;
- reopening clears previous resolved/closed outcome fields as appropriate.

## 4. Transactional writes

One transaction performs the related durable work:

1. insert `ticket_status_history` with previous/new state, reason and actor;
2. resume an SLA paused in `pending_customer` when leaving that state;
3. apply configured pause behavior for the destination state;
4. update ticket status, response/resolution/closed timestamps, root cause and outcome;
5. append `ticket.status_changed` audit evidence;
6. enqueue the minimized `ticket.status_changed` outbox event;
7. call `pg_notify` through `LiveEventsService` for an after-commit browser hint;
8. when resolving, queue the configured resolution notice or audit why it was skipped.

All database operations receive the same transaction `PoolClient`. Audit failure or outbox insert failure rejects the callback and rolls back the ticket/history too. PostgreSQL `NOTIFY` issued in the transaction is delivered only after commit.

Audit metadata records controlled transition values, not full ticket text. Outbox/live payloads contain only ids and status values required downstream.

## 5. Commit and asynchronous continuation

After commit:

- the API returns a projected public ticket;
- outbox dispatcher later publishes the durable event with at-least-once semantics;
- live listener sends a minimized SSE hint only to current/previous authorized scope;
- resolution communication may continue through approval/delivery workers;
- notification/menu audiences can be prompted to refetch.

Neither an outbox enqueue nor an SSE hint means an external consumer has finished. The database is authoritative.

## 6. React Query convergence

`useTicketMutation` calls the typed API action. On success it refreshes the ticket and affected cached views and shows a notification. Other browsers receive SSE ticket hints and invalidate/refetch rather than merging a partial event into cache.

On a 409, the mutation helper refreshes current ticket state so the user sees the colleague's update. The form should preserve user-entered reason where possible rather than silently retrying a state-changing command.

## Failure and status map

| Condition | Status/layer | Durable effect |
|---|---|---|
| missing/invalid token | 401 guard | none |
| invalid target/reason/timestamp shape | 400 pipe | none |
| no ticket update access/outside scope | 403 policy | business transaction rolls back; denial audit attempted separately |
| ticket absent/hidden | 404 service contract | none |
| redacted ticket | 409 service | none |
| stale expected timestamp | coded 409 service | none; frontend refetches |
| illegal workflow edge | conflict/refusal from workflow | none |
| missing root cause/outcome | 400 service domain check | history insert is rolled back |
| audit/outbox SQL failure | 500/controlled failure | entire transaction rolls back |
| SSE/listener unavailable after commit | no mutation failure | committed state remains; polling/resync repairs UI |

## Current optimistic-concurrency limitation

The current helper loads the ticket with a plain `SELECT`, compares `expectedUpdatedAt` in application code, then performs an `UPDATE` without an expected-version predicate. There is no `FOR UPDATE` on that read. Two transitions can therefore both read the same timestamp, both pass `assertFresh`, and then commit sequential updates; the later writer can overwrite the first state.

The hardened pattern is either:

```sql
UPDATE tickets
SET status = $new, updated_at = now()
WHERE id = $id AND updated_at = $expected
RETURNING *;
```

and require one returned row, or lock the ticket `FOR UPDATE` before checking and applying workflow rules. A version integer is often easier than timestamp equality. Tests should synchronize two connections and prove exactly one expected-version update wins.

This limitation applies to current general ticket stale checks; it should be stated rather than claiming fully atomic optimistic locking.

## Tests that prove the path

- policy units for roles, queue/sensitivity and auditor read-only behavior;
- DTO/E2E tests for malformed/unauthenticated requests;
- workflow integration tests for allowed/forbidden transitions and required outcomes;
- database integration assertion that history, ticket, audit and outbox commit together;
- injected audit failure assertion that all roll back;
- synchronized race test for the proposed conditional update/lock;
- frontend tests for allowed-state list, pending state, 409 refetch and preserved input;
- SSE test for commit-only notification and policy-filtered recipients.

## Interview answer

> The modal submits the desired status, reason and the `updatedAt` version it last saw through the shared bearer/correlation API client. `AuthGuard` establishes `UserContext`, the global pipe validates `TransitionTicketDto`, and `TicketsService` loads the current ticket, applies resource policy and workflow rules, including resolution root cause/outcome. One PostgreSQL transaction writes status history, updates SLA and ticket fields, appends minimized audit evidence, enqueues an outbox event and schedules a commit-time live hint; resolution can also queue a customer notice. React Query refetches after success or 409, while SSE only hints other clients to refetch. I would explicitly call out that the current timestamp check is not atomic because the read is unlocked and the update has no expected-version predicate; I would harden it with a conditional update or row lock and prove the race with two real database clients.
