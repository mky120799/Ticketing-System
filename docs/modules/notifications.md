# Notifications module

Notifications tell a staff user that something changed; they do not grant access to the referenced ticket. The module stores small audience-targeted records, exposes an inbox/read API and emits a live hint so the frontend can refresh.

## Wiring and routes

[`NotificationsModule`](../../apps/api/src/notifications/notifications.module.ts) is global, imports Auth, registers its controller/service and exports `NotificationsService` for ticket, intake, assignment and workflow code.

[`NotificationsController`](../../apps/api/src/notifications/notifications.controller.ts) uses `AuthGuard` and explicitly asserts `ticket:read`:

- `GET /notifications` returns the actor's current inbox.
- `POST /notifications/read` accepts at most 100 UUIDs, or marks all visible notifications when ids are omitted.

## Data and audience rules

`NotificationsService` inserts a notification with a type, minimized ticket identifier and either a direct user target or a queue/role target constrained by legal entity and country. Inbox SQL evaluates that audience against the current actor. Read state is stored per user in `notification_reads`; one queue member reading a notification does not mark it read for everyone else.

Creating a notification also emits a user/audience live event. The payload is only a refresh signal. On navigation, the ticket endpoint performs the normal `PolicyService.assertTicketAccess`; stale assignment or queue membership can therefore produce a legitimate `403/404` even though the old notification remains visible.

## Frontend

[`notification-menu.tsx`](../../apps/web/src/layout/notification-menu.tsx) fetches the inbox, renders unread state, marks selected records read and navigates to the associated ticket. [`use-live-updates.ts`](../../apps/web/src/live/use-live-updates.ts) invalidates the notification query when an SSE hint arrives.

The UI must handle the race where access changed after notification creation: show the API error and refresh the inbox rather than rendering notification metadata as ticket content.

## Tests and interview answer

Test direct and queue audiences, legal-entity/country isolation, per-user read state, the 100-id limit, “mark all” scope and revoked ticket access. Keep notification content free of customer free text and sensitive references.

> I implemented notifications as scoped presentation records. Producers target either a subject or a queue/role plus geographic scope. The inbox query evaluates the current actor and read state is per user. An SSE message only makes React Query refetch; opening the notification still calls the protected ticket API. That separation prevents a notification from becoming an accidental authorization capability.
