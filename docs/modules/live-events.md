# Live Events module

Live Events provides Server-Sent Events (SSE) hints for ticket and notification changes. It is an acceleration layer: payloads are minimized, every subscriber is policy-filtered and the browser refetches authoritative data through REST.

## Producer side

[`LiveModule`](../../apps/api/src/live/live.module.ts) is global, imports Auth and provides [`LiveEventsService`](../../apps/api/src/live/live-events.service.ts) plus [`LiveEventsController`](../../apps/api/src/live/live-events.controller.ts).

Domain services call `live.notify(client, type, ticket, previousQueue)` inside their PostgreSQL transaction. It executes `pg_notify` with ticket id, status, time and the minimum scope required for filtering. PostgreSQL delivers `NOTIFY` only after commit, so rolled-back changes do not reach clients. For a queue move, previous scope is included so both old and new authorized audiences can refresh.

Notification producers call `notifyPerson`, which carries no notification content—only target user or queue/role scope.

## Listener and authorization

Each API instance maintains one dedicated PostgreSQL `LISTEN ticket_live` connection and fans messages to its in-memory SSE subscribers. Reconnect uses exponential backoff up to 30 seconds. Since PostgreSQL notifications are ephemeral, reconnect broadcasts `resync` so clients refetch anything missed.

For each ticket message, `dispatch` calls `PolicyService.assertTicketAccess` against the embedded current/previous scope for every subscriber. Person events require exact user or queue+role+legal-entity+country matching. Malformed JSON is discarded.

## SSE endpoint

`GET /events/stream` uses `AuthGuard` and requires `ticket:read`. It returns `text/event-stream`, disables buffering/caching, sends a 25-second heartbeat and advertises a five-second reconnect delay. The service permits at most five streams per subject, returning `429` before hijacking the response.

The controller schedules stream closure at JWT expiry. This matters because an already-open HTTP connection would otherwise survive beyond the credential that authorized it. Disconnect cleanup removes the subscriber and clears timers.

## Frontend

[`use-live-updates.ts`](../../apps/web/src/live/use-live-updates.ts) opens the stream while authenticated. `ticket` events invalidate matching detail/list/dashboard queries, `notification` invalidates inbox data and `resync` refreshes broad relevant keys. It does not merge event fields into ticket cache as if they were complete state.

SSE is one-way and fits this use case better than WebSocket complexity. Browser reconnect and REST refetch provide eventual recovery if a live hint is lost.

## Tests and interview answer

Test commit-versus-rollback delivery, current/previous queue visibility, regional scope, direct notifications, malformed payloads, five-stream cap, expiry closure, listener reconnect/resync and subscriber cleanup.

> I used PostgreSQL `NOTIFY` plus SSE for small real-time hints. Producers notify inside the business transaction, so delivery occurs only on commit. Each API instance listens once and policy-filters every event for each subscriber. The stream ends at token expiry and sends only ids/status; React Query invalidates and refetches through the protected REST API. On listener reconnect, a resync event repairs the gap.
