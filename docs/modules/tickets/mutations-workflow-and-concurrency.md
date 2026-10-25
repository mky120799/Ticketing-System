# Tickets: mutations, workflow and concurrency

Ticket edits, notes, state changes, links, sensitive reference reveal and retention controls share a transaction/evidence pattern but apply different domain rules.

## Common service pattern

Most methods currently:

1. Start `PgService.transaction`.
2. Load the ticket with `SELECT * FROM tickets WHERE id=$1`.
3. Call `PolicyService.assertTicketAccess` with the specific permission.
4. Validate optional optimistic timestamp and domain state.
5. Update ticket/child rows.
6. Write audit and enqueue outbox using the same client.
7. Emit a transaction-bound live event where the UI needs immediate refresh.

The method-level permission matters: `ticket:update`, `ticket:assign`, `ticket:reveal`, `ticket:approve` and `ticket:hold` are not interchangeable.

## Edit and audit minimization

`PATCH /tickets/:id` can change priority, description and custom fields. `changeSummary` stores old/new priority directly, but free-text description evidence contains only changed flag, old/new lengths and SHA-256 fingerprints. Custom-field audit contains the bounded names of changed keys, not full values. This proves a change without making the immutable audit chain a second personal-data store.

The frontend sends the `updatedAt` it last read. `assertFresh` compares timestamps and returns a structured `409` with `code: stale_ticket`; `useTicketMutation` then refetches the ticket.

## Current concurrency limitation

The timestamp check is not fully atomic. `ticket()` does not select `FOR UPDATE`, and the following `UPDATE` does not include `updated_at = expected` in its `WHERE`. Two transactions can both read the same version, both pass `assertFresh`, then update serially; the second can overwrite the first.

The production-safe patterns are either:

```sql
UPDATE tickets
SET ..., updated_at = now()
WHERE id = $1 AND updated_at = $expected
RETURNING *;
```

with zero rows mapped to `409`, or `SELECT ... FOR UPDATE` before comparing. The compare-and-update SQL is usually preferable for simple optimistic concurrency. Documentation/interview answers should not claim the current implementation eliminates simultaneous lost updates.

## Notes

`POST /tickets/:id/notes` requires update access and rejects redacted tickets. Customer-visible notes additionally honor the communication block and set `first_responded_at` only if absent. Audit/outbox contain visibility but never the note body. A customer note is returned to Portal through its safe projection; internal notes are not.

## Status transitions

`POST /tickets/:id/status` rejects redacted work, checks the expected version, and calls `WorkflowDefinitionService.assertTransition(client, category, current, target, roles)`. It inserts `ticket_status_history` before updating status.

Resolving requires `rootCause`. Complaints/privacy requests also require an allowed IDR outcome. Entering `pending_customer` may pause SLA; leaving it resumes and extends deadlines. Resolve sets response/resolution/root-cause/outcome fields, reopen clears resolution fields, and close/cancel sets `closed_at`. Resolution invokes `ResolutionNoticeService.queue` before commit.

## Relationships

`POST /tickets/:id/relationships` requires update access to source and read access to target, then explicitly rejects cross-entity/country links. The composite primary key prevents duplicates; the service maps its named constraint error to `409`. Audit/outbox record target UUID and controlled relationship type.

## Sensitive reveal and retention control

Reference reveal requires `ticket:reveal` plus step-up and returns full values only for that response. The immutable event records count, not values.

Retention updates require `ticket:hold` plus step-up. Enabling a hold requires a reason; a manual retention date must be future. `ticket_retention_controls` is upserted, and audit records hold/date state plus bounded prior values while omitting the reason text.

## Frontend

[`description-card.tsx`](../../../apps/web/src/features/ticket/description-card.tsx), [`assign-modal.tsx`](../../../apps/web/src/features/ticket/assign-modal.tsx), [`change-status-modal.tsx`](../../../apps/web/src/features/ticket/change-status-modal.tsx) and ticket tabs invoke shared mutations. Controls use capabilities and `allowedNextStatuses` for usability; backend policy/workflow is repeated.

`409` triggers a fresh detail/list patch. `403/404` after an SSE-triggered refetch removes a ticket that moved outside current scope. The open ticket screen presents both identically to avoid existence disclosure.

## Tests and interview answer

Test policy per mutation, description audit minimization, redacted/blocked notes, workflow roles, required resolution fields, link access/cross-entity/duplicate behavior, step-up and maker-checker. Add a two-connection concurrency test that currently demonstrates the lost-update race, then make it pass with compare-and-update.

> Each mutation re-authenticates at the guard, loads the authoritative ticket, applies action-specific policy and domain rules, then commits state, audit and outbox together. Workflow transitions also update history, SLA and resolution notices. The UI sends `updatedAt` and handles stale 409 by refetching. I would be precise that the current timestamp check is not atomic under simultaneous requests; the fix is an `UPDATE ... WHERE updated_at = expected RETURNING` and a zero-row 409.
