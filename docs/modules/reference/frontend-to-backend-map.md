# Frontend-to-backend implementation map

[Reference index](README.md) · [Frontend index](../../frontend/README.md) · [Flow index](../../flows/README.md)

There are two React/Vite applications: staff console (`apps/web`) and customer portal (`apps/portal`). Both use typed client functions, but their identity and ownership boundaries are separate.

## Staff console map

| User surface | React code | Typed API calls / route family | Nest owner | Cache/convergence |
|---|---|---|---|---|
| Login/session | `auth.ts`, `SessionProvider`, `LoginPage` | OIDC then `GET /me` | Auth guard + Directory/Profile | `/me` cached for session; token events update session |
| Ticket queue/search | `tickets-page`, `ticket-table`, query hooks | `GET /tickets`, `/tickets/search` | Tickets | infinite cursor pages/search keys; live/list invalidation |
| Ticket detail | `ticket-page`, header/sidebar/tabs | `GET /tickets/:id` | Tickets | detail query refetched after mutation/SSE |
| Create/edit/assign/status | modals + `useTicketMutation` | POST/PATCH ticket routes | Tickets + Workflow/Assignment | refresh detail/list; 409 forces authoritative refresh |
| Notes/activity | `activity-tab` | `POST /tickets/:id/notes` | Tickets | refresh ticket; customer note also affects SLA/portal |
| Attachments | `attachments-tab` | intent, direct PUT, complete, download | Tickets + Storage | state refetch through scan progression |
| Communications/approval | `communications-tab` | communication/approval routes | Tickets + Email/Integration | durable status displayed after refetch/live hints |
| Audit | `audit-page`, `audit-tab` | `/audit/events`, report/export/verify | Audit | filter-specific query; event/view/export self-audited |
| Dashboard | dashboard widgets | `/dashboard/summary`, `/trends` | Dashboard | summary/trend keys; invalidated by ticket events |
| Notifications | `notification-menu` | `/notifications`, `/read` | Notifications | direct/queue hint invalidates inbox |
| Administration | admin page sections | `/configuration`, workflow, compliance, operations | Configuration/Workflow/Compliance/Operations | targeted config keys refetched after save |
| Live synchronization | `use-live-updates` | `GET /events/stream` | Live | event is hint; invalidate/refetch, broad resync on reconnect |

## Customer portal map

| User surface | Portal code | API family | Backend boundary | Important rule |
|---|---|---|---|---|
| Sign-in/session | portal `auth.ts`, `session.ts` | portal OIDC audience | `PortalAuthGuard` | customer token never becomes staff `UserContext` |
| New request | `new-request-form.tsx` | `POST /portal/requests` | Portal -> Intake | customer subject-derived reference + idempotency/routing |
| Request list/detail | `app.tsx`, `request-detail.tsx` | `GET /portal/requests[/id]` | Portal | ownership query uses verified subject; safe projection only |
| Reply/history | detail/history components | `POST /portal/requests/:id/messages` | Portal -> CustomerReply | re-proves ownership; resumes pending-customer SLA atomically |
| Documents | `documents.tsx` | portal attachment intent/complete | PortalAttachments + Storage | direct object PUT; never visible before clean scan |
| Capability upload page | `upload-page.tsx` | `/upload/...` with narrow header token | Uploads | no bearer session; expiring/revocable one-purpose capability |

## Shared request behavior

The staff API helper centralizes:

```text
base URL from runtime config
Bearer access token
fresh correlation id
JSON headers and parsing
401 -> sign-out
step_up_required -> session banner/event
non-2xx -> ApiError(status, code, message)
```

Screens do not call `fetch` for ordinary API JSON because bypassing the helper would create inconsistent authentication, correlation and error handling. Direct object-storage PUT and SSE streaming are deliberate exceptions with their own protocol requirements.

## Cache rule

TanStack Query caches authorized server representations for the current browser session. It is not an authorization cache. On every refetch, the API can return less data, 403 or 404 because role/scope/resource state changed.

Key hierarchy:

```text
['tickets']                   all list/search variants
['tickets','list',search]     one queue/search result
['ticket',id]                 one detail and descendant keys
['ticket',id,'audit']         ticket evidence
['dashboard',...]             aggregates
['config',name,...args]       administration data
['notifications']             current inbox
```

Mutation behavior should name exactly which representations can become stale. Over-invalidating is safe but expensive; under-invalidating leaves misleading UI.

## Error-to-UX contract

| API result | Frontend behavior |
|---|---|
| 400 | keep form values; show field/request problem |
| 401 | session unusable; sign out/recover, never infinite retry |
| 403 | show denial; if `step_up_required`, offer reauthentication |
| 404 | show safe not-found or remove stale inaccessible row |
| 409 `stale_ticket` | preserve draft, refetch current ticket, require deliberate retry |
| 409 idempotency/receipt conflict | explain logical conflict; do not silently resubmit with new key |
| 429 | back off and avoid reconnect/retry storm |
| network/5xx | retain user input; retry only when operation/idempotency semantics permit |

## Live-event rule

SSE payloads contain only event kind, ticket id, status or an empty notification/resync signal. The browser does not treat them as complete state because:

- PostgreSQL notifications are ephemeral;
- connection recovery can miss events;
- at-least-once/reconnect can duplicate hints;
- payload is deliberately minimized;
- current authorization may differ from producer-time scope.

The event identifies what to refetch. REST applies current policy and returns the authoritative projection.

## Presentation capability versus security

Frontend role mapping answers “should this user see a route/button?” Backend policy answers “may this verified actor perform this operation on this current resource?” Always implement both for usability plus security, and test the API with a manually crafted request that bypasses the UI.

## Full-stack trace template

For every feature, fill in:

```text
component and user gesture:
local form validation/pending behavior:
typed API function:
token/correlation/idempotency headers:
controller route + DTO:
service policy + current-state checks:
transaction/tables/locks:
audit/outbox/live effects:
response/error code:
query keys refreshed:
failure state and input preservation:
frontend test + backend tests:
```

An interview answer is incomplete if it explains the Nest service but cannot say how the browser invokes it, recovers from 409/401, and converges its cache.
