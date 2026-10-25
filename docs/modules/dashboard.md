# Dashboard module

The Dashboard module exposes policy-scoped operational aggregates. It is a read model over authoritative ticket, SLA, complaint and privacy data; it is not a cached copy of authorization rules.

## Wiring and routes

[`DashboardModule`](../../apps/api/src/dashboard/dashboard.module.ts) imports Auth, Outbox and Tickets, registers [`DashboardController`](../../apps/api/src/dashboard/dashboard.controller.ts) and `DashboardService`, and reuses `SlaService` for reconciliation.

All routes use `AuthGuard`:

| Route | Result |
|---|---|
| `GET /dashboard/summary` | Current counts and operational breakdowns |
| `GET /dashboard/trends?weeks=12` | Bounded weekly trend series |
| `POST /dashboard/sla/reconcile` | Privileged SLA repair/recalculation |

## How a summary is built

`DashboardService.summary` first calls `PolicyService` for `dashboard:read`. It derives SQL predicates from the actor's legal-entity, country and queue scope, then runs aggregates for open work, overdue SLAs, escalations, root causes, channels, complaints and privacy work. Scope values are bound parameters; user input is never concatenated into SQL.

The result is safe only because every aggregate uses the same scope. A global total next to a scoped breakdown would leak information even if no ticket row were returned. The service records a bounded `dashboard.viewed` audit event containing the view type and correlation id, not every underlying ticket.

`trends` applies the same scope and constrains the number of weeks. It groups by stable time buckets in PostgreSQL and fills/normalizes the series for the frontend. This keeps counting semantics on the server and prevents different browsers from calculating different totals.

SLA reconciliation is a write-like administrative operation. It requires its own permission, delegates to `SlaService.reconcile`, and audits what was recalculated. It should not be inferred from `dashboard:read`.

## Frontend flow

[`dashboard-page.tsx`](../../apps/web/src/features/dashboard/dashboard-page.tsx) issues the summary and trend queries. [`dashboard-widgets.tsx`](../../apps/web/src/features/dashboard/dashboard-widgets.tsx) renders cards and charts from server-provided values. Filters change query keys and trigger a refetch; they do not filter a broader unauthorized payload in the browser.

Loading, empty, permission and server-error states are rendered separately. A dashboard tile may link to a ticket list, but the destination performs a new authorized query—the aggregate is never treated as proof that the user can open a ticket.

## Failure and performance behavior

- Invalid `weeks` input is bounded rather than allowing an unbounded historical scan.
- Database indexes should match status, scope and timestamp predicates used by the aggregates.
- A stale dashboard is acceptable for presentation only if the cache key includes the complete actor scope and has a short TTL; authorization must still run on each ticket read.
- Reconciliation must be safe to repeat and must report/audit partial failures.

## Tests and interview answer

Integration tests should create tickets in two legal entities and prove that a scoped user never sees the other entity in totals or trends. Also test queue restrictions, zero-data responses, week bounds and reconciliation permission.

> I implemented the dashboard as a scoped read model. After `AuthGuard`, `DashboardService` checks `dashboard:read`, converts the actor's legal-entity, country and queue grants into parameterized SQL predicates, and applies those predicates to every aggregate. The React page requests only the scoped summary and trend series. Clicking a number performs another authorized API request, so dashboard data never becomes an authorization grant.
