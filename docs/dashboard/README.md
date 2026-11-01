# Dashboard: scoped operational aggregates

> **Read model / aggregates**: counts and percentages (active, overdue, on-time %, complaints at risk, root causes, channels, ageing, weekly trends) computed by SQL across the tickets the viewer is allowed to see.
> In plain words: the supervisor's wall chart. It shows totals for *their* queues only, and never any ticket content.

Who: supervisors and auditors (`dashboard:read`).

## Where it lives

| File | Role |
|---|---|
| [dashboard/dashboard.service.ts](../../apps/api/src/dashboard/dashboard.service.ts) | `summary` (10 aggregate queries), `trends` (weekly series + breakdowns) |
| [dashboard/dashboard.controller.ts](../../apps/api/src/dashboard/dashboard.controller.ts) | `GET /summary`, `GET /trends?weeks=`, `POST /sla/reconcile` |
| [features/dashboard/dashboard-page.tsx](../../apps/web/src/features/dashboard/dashboard-page.tsx) | Layout and data loading |
| [features/dashboard/dashboard-widgets.tsx](../../apps/web/src/features/dashboard/dashboard-widgets.tsx) | Stat tiles, bars, line chart, chart/table toggle |

## Read in this order

1. [How the dashboard works](how-it-works.md): scope in SQL, each aggregate, trends, audit, the UI and its accessibility choices.
2. [Interview Q&A](interview-qa.md)

## 30-second answer

> After `AuthGuard`, the dashboard service checks `dashboard:read` and runs every aggregate with the same parameterised scope (the viewer's legal entity, country and queues) using `COUNT(*) FILTER (WHERE ...)` for many counts in one pass. Trends use `generate_series` so empty weeks show zero. Each view is audited as one bounded event. The React page renders server numbers only, offers a table alternative for every chart, and clicking through to tickets runs a fresh, authorised query. A dashboard number is never an access grant.

## Related

[SLA](../sla/README.md) · [Compliance](../compliance/README.md) · [Auth](../auth/README.md) · [Frontend architecture](../frontend-architecture/README.md)
