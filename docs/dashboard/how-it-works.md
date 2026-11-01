# How the dashboard works

[Back to Dashboard index](README.md) · Code: [dashboard.service.ts](../../apps/api/src/dashboard/dashboard.service.ts)

---

## 1. Scope is in every query

[summary, L11-L38](../../apps/api/src/dashboard/dashboard.service.ts#L11-L38):

```ts
this.policy.assertPermission(user, 'dashboard:read');
const scope = [user.legalEntity, user.country, user.queues];   // $1, $2, $3 in EVERY aggregate
```

**Why this matters:** a global total shown next to a scoped breakdown leaks information even if no ticket row is returned ("there are 500 tickets overall, I can see 40, so 460 are elsewhere"). Using one scope for every number prevents that.

## 2. The aggregates

| Block | Technique | Line |
|---|---|---|
| Totals: total, active, resolved, closed, overdue | One scan with `count(*) FILTER (WHERE ...)` | [L15](../../apps/api/src/dashboard/dashboard.service.ts#L15) |
| Per queue: total, active, overdue | `GROUP BY queue` | [L16](../../apps/api/src/dashboard/dashboard.service.ts#L16) |
| Ageing buckets of open tickets | `CASE WHEN now()-created_at < interval '1 day' ...` | [L17](../../apps/api/src/dashboard/dashboard.service.ts#L17) |
| Last 30 days: resolved, on time, responded, responded on time, average first-response minutes | `FILTER` + `avg(extract(epoch ...))` | [L19-L25](../../apps/api/src/dashboard/dashboard.service.ts#L19-L25) |
| Escalations in 30 days | join `ticket_escalations` | [L26](../../apps/api/src/dashboard/dashboard.service.ts#L26) |
| Root causes, channels | `GROUP BY` | [L27-L28](../../apps/api/src/dashboard/dashboard.service.ts#L27-L28) |
| Complaints: open, ack overdue, at risk, overdue, vulnerable, with AFCA | `FILTER` on regulatory fields | [L29](../../apps/api/src/dashboard/dashboard.service.ts#L29) |
| Privacy requests: open, overdue | `case_kind='privacy_request'` | [L31](../../apps/api/src/dashboard/dashboard.service.ts#L31) |

**`COUNT(*) FILTER (WHERE condition)`**: PostgreSQL syntax to count different subsets in **one** pass over the rows, instead of one query per number.

Percentages are computed in TypeScript with a divide-by-zero guard (`pct`, [L32](../../apps/api/src/dashboard/dashboard.service.ts#L32)): `null` when there's no data, shown as "—" rather than a fake 0%.

All queries run in one transaction (a consistent snapshot), followed by an audit event `dashboard.viewed` with the queue count only ([L34](../../apps/api/src/dashboard/dashboard.service.ts#L34)).

## 3. Trends

[trends, L41-L58](../../apps/api/src/dashboard/dashboard.service.ts#L41-L58):

```sql
WITH w AS (SELECT generate_series(date_trunc('week', now()) - (($4 - 1) * interval '1 week'), date_trunc('week', now()), interval '1 week') AS week)
SELECT to_char(w.week,'YYYY-MM-DD'),
  (SELECT count(*) FROM tickets t WHERE <scope> AND date_trunc('week', t.created_at)  = w.week) AS created,
  (... resolved_at ...) AS resolved, (... is_complaint ...) AS complaints, (... ticket_escalations ...) AS escalated
FROM w ORDER BY w.week
```

- `weeks` is clamped to 1-52 ([L43](../../apps/api/src/dashboard/dashboard.service.ts#L43)), so a huge input can't trigger a huge scan.
- `generate_series` creates one row per week, so **weeks with no tickets show 0** instead of disappearing from the chart.
- Breakdowns by category, branch and queue (top 20) use a helper with a fixed column name from a TypeScript union ([L54](../../apps/api/src/dashboard/dashboard.service.ts#L54)), never user input.
- Audited as `dashboard.trends_viewed`.

## 4. Manual SLA reconcile

`POST /dashboard/sla/reconcile` → `SlaService.reconcile` with its own `sla:reconcile` permission. It's a write-like action, not implied by `dashboard:read` ([SLA](../sla/how-it-works.md#5-reconciliation)).

## 5. Frontend

[dashboard-page.tsx#L25-L128](../../apps/web/src/features/dashboard/dashboard-page.tsx#L25-L128), with reading order "right now → regulatory risk → trends → where the problems are":

| Widget | File | Design rule |
|---|---|---|
| `StatTile` | [widgets L18-L31](../../apps/web/src/features/dashboard/dashboard-widgets.tsx#L18-L31) | Red only when action is needed (`tone="alert"`) |
| `SingleBars` | [L50-L67](../../apps/web/src/features/dashboard/dashboard-widgets.tsx#L50-L67) | HTML bars with the value printed beside each bar; a non-zero value always gets a visible sliver; read as a list by screen readers |
| `CreatedResolvedChart` | [L70-L81](../../apps/web/src/features/dashboard/dashboard-widgets.tsx#L70-L81) | Two series with a legend (identity never by colour alone), colour-blind-safe palette |
| `ChartOrTable` | [L34-L43](../../apps/web/src/features/dashboard/dashboard-widgets.tsx#L34-L43) | Every chart can switch to its exact table |
| Weeks selector | page [L83](../../apps/web/src/features/dashboard/dashboard-page.tsx#L83) | Changes the query key `['dashboard','trends',weeks]` |
| "Complaints register (CSV)" | page [L52](../../apps/web/src/features/dashboard/dashboard-page.tsx#L52) | Step-up protected download ([compliance](../compliance/reports-and-privacy.md#2-complaints-register)) |

The page header says "Counts across your queues... Never ticket content."

## 6. Tests

Dashboard 403 for agents and 200 for supervisors with totals ([ticket.integration-spec.ts#L43](../../apps/api/test/ticket.integration-spec.ts#L43)); trends return the requested number of weeks with counts ([workflow.integration-spec.ts#L292](../../apps/api/test/workflow.integration-spec.ts#L292)).

**Worth adding:** tickets in two legal entities, asserting a scoped user never sees the other entity in any number.

## 7. Performance notes

- Indexes on `(legal_entity, country, queue, created_at)` (paging index) and `(sla_status, resolution_due_at)` support most predicates.
- The trend query uses correlated subqueries per week (fine for ≤ 52 weeks). At large scale, a materialised daily rollup table would be faster.
