# Frontend feature and route map

This page is the concise map; follow the linked guides for implementation detail.

| Surface | Route/application | Detailed guide |
|---|---|---|
| Staff shell and route guards | `apps/web`, all routes | [Bootstrap and routing](staff-console-bootstrap-and-routing.md) |
| Staff login/session/step-up | staff shell | [Authentication and session](authentication-and-session.md) |
| HTTP and errors | all staff features | [API client](api-data-flow.md) |
| Ticket queue/create/search | `/tickets` | [Ticket list and React Query](ticket-list-and-react-query.md) |
| Ticket detail/tabs/actions | `/tickets/:ticketId` | [Ticket workspace](ticket-workspace.md) |
| Dashboard | `/dashboard` | [Dashboard module](../modules/dashboard.md) |
| Audit | `/audit` and ticket tab | [Audit frontend](../modules/audit/frontend.md) |
| Configuration/outbox recovery | `/admin/:section` | [Administration](administration.md) |
| Customer self-service | separate `apps/portal` | [Customer portal](customer-portal.md) |

[`roles.ts`](../../apps/web/src/session/roles.ts) maps roles to coarse capabilities used by routing/navigation. Those checks are never backend authorization. Direct API calls receive the same guard/policy decision whether or not a component rendered a button.
