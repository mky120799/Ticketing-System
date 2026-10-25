# Authorization module

Authorization answers: “May this authenticated identity perform this action on this resource?” It is implemented by [`PolicyService`](../../apps/api/src/auth/policy.service.ts), supplemented by workflow, step-up and domain invariants. Route guards authenticate the caller; frontend role checks only improve presentation.

## Inputs to a decision

`AuthGuard` creates a [`UserContext`](../../apps/api/src/auth/user-context.ts) containing stable subject, allowlisted roles, branch, queues, department, legal entity, country, service-identity flag and step-up facts. Ticket queries load a `TicketPolicySubject` with queue, branch, department, entity, country, sensitivity, creator and assignee.

The policy service defines a closed `Permission` union and an explicit role-to-permission map. Unknown token roles are filtered out during authentication; a role absent from the map receives no permission. Machine roles each carry one narrow capability.

## Permission matrix in code

The essential mapping is:

| Role | Permission intent |
|---|---|
| branch/call-center agent | create and read tickets |
| case agent | create, read and update |
| supervisor | case work plus assign, approve, reveal, hold, SLA and dashboard |
| auditor | read tickets, audit and dashboard only |
| administrator | configuration and SLA administration, no ticket read |
| attachment scanner | submit scan results only |
| integration reconciler | reconcile outbox receipts only |
| notification provider | submit delivery receipts only |
| intake gateway | create through Intake only |

`has` checks whether any role grants the permission. `assertPermission` throws a generic `403 Permission denied`. Multiple roles are additive for permission only; resource scope is still evaluated.

## Ticket policy algorithm

`assertTicketAccess(user, ticket, permission)` executes:

```ts
assertPermission(user, permission);

const sameEntity = user.legalEntity === ticket.legal_entity
  && user.country === ticket.country;
const queueAllowed = user.queues.includes(ticket.queue);
const branchAllowed = user.branch === ticket.branch_code;
const ownsCase = ticket.created_by === user.subject
  || ticket.assigned_to === user.subject;

const scopeAllowed = user.roles.includes('supervisor')
  || user.roles.includes('auditor')
    ? queueAllowed
    : queueAllowed && (branchAllowed || ownsCase);

const sensitivityAllowed = ticket.sensitivity !== 'restricted'
  || user.roles.includes('supervisor')
  || user.roles.includes('auditor');
```

Access is denied unless entity/country, scope and sensitivity all pass. This provides three independent containment layers:

1. Legal entity and country prevent cross-tenant/cross-jurisdiction access.
2. Queue limits the operational population.
3. Branch or ownership narrows ordinary agents, while supervisors/auditors operate queue-wide.

Restricted cases are visible only to supervisors and auditors. Auditors still cannot mutate because their role has `ticket:read` but not `ticket:update`.

## Where the check belongs

For a single ticket mutation, the service must load the authoritative row and call policy before changing it. The ideal locking form is:

```ts
return db.transaction(async (client) => {
  const ticket = await client.query('SELECT ... FOR UPDATE', [ticketId]);
  policy.assertTicketAccess(user, ticket.rows[0], 'ticket:update');
  // workflow/version/domain checks and write
});
```

Checking after loading the row is necessary because queue, sensitivity and assignment are resource attributes. Important current detail: most `TicketsService` mutations execute inside a transaction but use a plain ticket `SELECT`, not `FOR UPDATE`; approval/attachment subrows and escalation do use locks. Transactions alone do not freeze an unlocked row. Moving scope-changing mutations to a lock or compare-and-update predicate is a required concurrency hardening step.

List/search first apply entity/country/queue in SQL and then run the complete branch/ownership/sensitivity policy in memory before returning rows. This is response-safe but may fetch rows later discarded; encoding the complete equivalent predicate in SQL is the scalable target. Dashboard and audit aggregate/search queries already push their scope predicates into SQL. Detail and mutations call `assertTicketAccess` directly.

## Additional controls

- `assertStepUp` requires recent `auth_time` or accepted `acr` for sensitive actions and returns structured `step_up_required`.
- `assertMakerChecker` compares requester and approver subjects and forbids self-approval.
- `WorkflowDefinitionService` validates status edges and optional role restrictions.
- Optimistic concurrency rejects a permission-valid but stale mutation with `409`.
- Retention/legal-hold and communication-block rules are domain controls after policy.

These are not all “RBAC.” The design combines role permission with attributes (ABAC), workflow and separation of duties.

## Frontend behavior

[`roles.ts`](../../apps/web/src/session/roles.ts) maps staff roles to coarse UI capabilities. `SessionProvider` exposes `can(capability)`, which hides routes/buttons a user normally cannot use. The API may still return `403` if the resource scope, sensitivity, step-up or current state fails.

Never send a broad ticket dataset and filter it in React. The browser is observable and modifiable by the user. Server queries must return only authorized rows; direct URL navigation must be safe even if a hidden button is manually recreated.

## Denials and evidence

Authentication failures are `401`; a valid identity failing permission/scope is `403`; some read APIs may use a non-enumerating not-found response. [`DeniedAuthorizationInterceptor`](../../apps/api/src/audit/denied-authorization.interceptor.ts) observes `403`, writes a separate `authorization.denied` audit event after the failed business transaction, then rethrows the original error.

The denial event contains actor, correlation id, bounded path and target id—not a token or customer payload.

## Testing strategy

Use a Cartesian policy suite: each role against same/different entity, country, queue, branch, owner/assignee and sensitivity. Then test the HTTP/service integration to prove the policy is actually called. Include multi-role actors, service identities, maker-checker and step-up cases. See [`security.policy.spec.ts`](../../apps/api/test/security.policy.spec.ts) and the full [roles and access matrix](../security/roles-and-access.md).

## Interview answer

> I use RBAC for action permission and attributes for row-level scope. `AuthGuard` creates an allowlisted `UserContext`; after loading the ticket, `PolicyService` checks permission, entity/country, queue, branch-or-ownership and sensitivity. Lists apply coarse SQL scope and full policy before return; aggregates push scope into SQL. Step-up, maker-checker and workflow layer on top. I would not claim transactions automatically lock tickets—the current general mutation path still needs atomic compare-and-update hardening. React hides controls only for usability, and every 403 is minimized audit evidence.
