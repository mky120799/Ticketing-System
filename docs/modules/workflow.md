# Workflow module

Workflow has two related jobs: it defines which ticket status transitions are legal, and it runs scheduled SLA/regulatory/escalation work. The API remains the only component allowed to mutate ticket state; the scheduler invokes the same domain services as interactive requests.

## Wiring

[`WorkflowModule`](../../apps/api/src/workflow/workflow.module.ts) is global. It imports Auth, Tickets and Operations and provides `WorkflowDefinitionService`, `WorkflowDefinitionController`, `EscalationService` and `WorkflowScheduler`. The definition service is exported so `TicketsService` can validate transitions inside its transaction.

## Workflow definitions

The guarded administration API is:

- `GET /configuration/workflows`
- `PUT /configuration/workflows/:workflowKey`

[`WorkflowDefinitionService`](../../apps/api/src/workflow/workflow-definition.service.ts) stores definitions in `workflow_definitions` and edges in `workflow_transitions`. A ticket category points to a workflow key. Each edge contains `from_status`, `to_status` and optional `allowed_roles`.

`assertTransition(client, category, from, to, roles)` joins category, active definition and transition. No row means `409 Conflict`; an edge with no matching role means `403 Forbidden`. It accepts the caller's transaction client so transition checking and the subsequent ticket update observe one consistent database transaction and do not need a second pool connection.

Before replacing a workflow, `assertUsable` verifies:

- no self-transition exists;
- `submitted` has an outgoing edge;
- every non-terminal status represented in the graph can reach `closed` or `cancelled`;
- at least one terminal status exists.

The full replacement transaction reads a bounded previous-state summary, upserts the definition, replaces edges, writes `configuration.workflow_updated` audit evidence and enqueues `configuration.workflow_changed`.

## Runtime ticket transition

When staff post `/tickets/:id/status`, `TicketsService` locks the ticket, checks ticket access and optimistic version, then calls `assertTransition`. Only after that does it update status/history, pause or resume SLA state, generate required notices and write audit/outbox/live records. `nextStatuses` returns role-filtered choices for presentation, but the mutation revalidates the edge to close time-of-check/time-of-use gaps.

## Scheduler and escalation

[`WorkflowScheduler`](../../apps/api/src/workflow/workflow-scheduler.ts) starts only when `WORKFLOW_SCHEDULER_ENABLED=true`. Each tick acquires PostgreSQL transaction advisory lock `804232`; with several API replicas, one runs and the rest return `null`.

A tick reconciles SLA status, reconciles regulatory deadlines and executes [`EscalationService`](../../apps/api/src/workflow/escalation.service.ts). At longer intervals it can run retention, audit-chain verification/anchoring and report export when their feature flags are enabled.

Escalation loads active rules and a bounded candidate batch. Every candidate is re-read `FOR UPDATE`, because a user could resolve or move it between candidate selection and mutation. `ticket_escalations` has a unique `(ticket_id, rule_key)` constraint, making repeated ticks idempotent. A successful escalation moves queue, clears assignment, optionally raises priority, writes status history/audit/outbox, emits a live event and creates notifications.

## Frontend

[`workflows-section.tsx`](../../apps/web/src/features/admin/sections/workflows-section.tsx) edits definitions. Ticket status controls use allowed-next-state data to avoid offering impossible actions. This is usability only; the API remains authoritative and can reject a stale selection.

## Tests and interview answer

Test graph reachability, self-loops, role-limited edges, inactive workflows, replacement rollback, concurrent scheduler ticks, duplicate escalation, candidate recheck and terminal ticket exclusion. See [`workflow.integration-spec.ts`](../../apps/api/test/workflow.integration-spec.ts).

> I implemented workflows as database-backed directed graphs associated with ticket categories. The service verifies that each graph can reach a terminal state, and ticket transitions query the active edge inside the same transaction that updates the ticket. A scheduler uses a PostgreSQL advisory lock so only one replica processes a tick. Escalations re-lock each ticket and use a unique ticket/rule key, making repeated or concurrent ticks safe.
