# Frontend: ticket workspace

[`TicketPage`](../../apps/web/src/features/ticket/ticket-page.tsx) is the staff case workspace at `/tickets/:ticketId`. It composes a stable summary/header with task-specific tabs.

## Load and non-enumeration behavior

`useTicket(ticketId)` reads the full authorized projection. Pending shows skeletons. A 403 or 404 produces the same “not available” state, avoiding a UI distinction between nonexistent and forbidden tickets. Other failures show retry.

The current route parameter is passed directly to the API; backend should normalize malformed UUIDs to 400 as noted in ticket docs.

## Layout and URL state

`TicketHeader` shows status/badges and action buttons. `DescriptionCard` handles main edit. `CaseSidebar` keeps assignment, SLA and masked reference facts visible. The primary area uses tabs:

- Activity: notes/status history and add-note behavior.
- Communications: template-driven messages and approval decision.
- Attachments: declare/upload/complete/download states.
- Related: authorized ticket linking.
- Compliance: complaint/dispute/communication-block controls.
- Retention: supervisor-only hold/date controls.
- Audit: auditor-only ticket evidence.

Active tab lives in `?tab=...`, surviving refresh/share. `keepMounted={false}` prevents inactive tab trees and their API work from remaining mounted. Narrow screens horizontally scroll tab labels rather than wrapping.

## Capability versus resource state

`can('workTicket')`, `can('supervise')` and `can('viewAudit')` decide which controls/tabs appear. Components also disable actions based on redaction, communication blocks, scan state, allowed workflow transitions and pending mutation.

These checks are usability only. A role-capable supervisor may still lack this ticket's queue/entity scope or need step-up; the API response decides.

## Mutation examples

- Description change sends `expectedUpdatedAt`; success refetches, `409` refetches newer version.
- Status modal only offers `allowedNextStatuses`, then sends reason/outcome/root cause/current version.
- Assignment sends queue/assignee/current version; current backend membership gap is not solved by the picker.
- Communication creation displays queued versus pending approval, not “sent.”
- Attachment upload stays unavailable until a later clean scan state arrives.
- Reveal/export may trigger the global step-up banner rather than local ad-hoc login.

## Live updates

SSE events carry ticket id/status only. `useLiveUpdates` calls `refreshTicket`; the API may now deny access and cache removes the ticket. This supports concurrent staff without merging incomplete event payload into the full ticket object.

The stream reconnects on renewed user object, uses exponential backoff and broad invalidation after reconnect/resync because PostgreSQL notifications are not replayable.

## Accessibility/error design

The page uses semantic title hierarchy, tab roles, labeled controls, loading/error/empty components and plain-language status labels. Customer/security-sensitive values remain masked until a separately authorized reveal.

## Interview answer

> The ticket workspace reads one full server projection and splits tasks into URL-addressable tabs while keeping summary/SLA/reference context visible. Components offer actions from capabilities and server-returned allowed transitions, but API policy remains final. All mutations share a hook that refetches detail and list caches; stale 409 and SSE changes converge through the same path. Forbidden and missing tickets render identically to reduce enumeration.
