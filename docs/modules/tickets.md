# Tickets module

The Tickets module is the case-management core. It owns ticket creation, scoped reads, edits, status changes, assignment, notes, communications, relationships, approvals, retention controls and staff-side attachments. It coordinates several modules, but it does not replace their responsibilities: policy decides access, Workflow decides legal state changes, Storage owns bytes, Audit records evidence and Outbox publishes integration events.

## Module wiring

[`TicketsModule`](../../apps/api/src/tickets/tickets.module.ts) imports `AuthModule`, `OutboxModule` and `ConfigurationModule`. It registers [`TicketsController`](../../apps/api/src/tickets/tickets.controller.ts), [`TicketsService`](../../apps/api/src/tickets/tickets.service.ts), `SlaService`, `AssignmentService`, `ResolutionNoticeService`, `UploadLinkService` and `AttachmentScanWorker`. It exports the SLA and assignment services because Intake, Dashboard and background work reuse them.

`TicketsService` receives the database, policy, audit, SLA, outbox, case configuration, object storage, live events, assignment, compliance, workflow, notification, resolution-notice and upload-link providers. This is intentional orchestration: the ticket aggregate owns the business transaction while specialist providers implement one rule each.

## HTTP surface

All `/tickets` routes use `AuthGuard`.

| Method and path | Service operation | Important rule |
|---|---|---|
| `POST /tickets` | `create` | Requires `Idempotency-Key` |
| `GET /tickets` | `list` | Cursor pagination and policy scope |
| `GET /tickets/search` | `search` | Bounded, authorized search |
| `GET /tickets/:ticketId` | `get` | Ticket-level access check |
| `PATCH /tickets/:ticketId` | `update` | Optimistic concurrency |
| `POST /tickets/:ticketId/status` | `transition` | Workflow transition validation |
| `POST /tickets/:ticketId/assignments` | `assign` | Target queue must be in supervisor scope; see assignee-validation gap below |
| `POST /tickets/:ticketId/notes` | `addNote` | Note visibility and content validation |
| `POST /tickets/:ticketId/communications` | `createCommunication` | Template/contact and delivery state |
| `POST /tickets/:ticketId/attachments` | `createAttachment` | Creates metadata and a presigned upload |
| `POST .../attachments/:id/complete` | `completeAttachment` | Verifies declared size/checksum, then queues scanning |
| `POST .../attachments/:id/scan` | `recordAttachmentScan` | Restricted scanner/service operation |
| `GET .../attachments/:id/download` | `downloadAttachment` | Only clean files receive a short-lived URL |
| `POST /tickets/:ticketId/relationships` | `linkTicket` | Checks access to both tickets |
| `POST /tickets/:ticketId/approvals` | `requestApproval` | Creates maker-checker work |
| `POST .../approvals/:id/decision` | `decideApproval` | Step-up and self-approval restrictions |
| `PUT /tickets/:ticketId/retention` | `updateRetentionControl` | Legal hold/retention permission |
| `POST /tickets/:ticketId/sensitive-reveals` | `revealReferences` | Explicit reveal permission and audit |

Read the DTO constraints in [`ticket.dto.ts`](../../apps/api/src/tickets/ticket.dto.ts); the global validation pipe rejects unknown properties and transforms accepted input before a service runs.

## Creation path, at code level

The controller rejects a missing or oversized idempotency key, then passes `request.user` and `request.correlationId` to `TicketsService.create`.

Inside the transaction, the service follows this sequence:

1. Assert the caller has the create permission and validate the selected legal entity, country, queue and category with `CaseConfigurationService`.
2. Hash the normalized request. Read `idempotency_records` for the actor and key. The same key plus the same hash returns the original result; the same key with different input is a conflict.
3. Insert the `tickets` aggregate and its public/masked `ticket_references` row.
4. Use `SlaService` to calculate response and resolution targets from the configured business calendar.
5. Apply complaint/privacy classification through `ComplianceService` where the request requires it.
6. Append the audit event and enqueue the domain event by passing the same PostgreSQL client to both providers. A rollback therefore removes the ticket, audit event and outbox event together.
7. Attempt rule-based assignment and publish a minimal live notification after commit.

The important interview point is that idempotency is persisted, not held in memory. It still works across API replicas and process restarts.

## Mutation pattern and concurrency

Ticket mutations deliberately repeat this broad skeleton:

```ts
await db.transaction(async (client) => {
  const ticket = await loadTicket(client, ticketId);
  policy.assertTicketAccess(actor, ticket, requiredPermission);
  assertExpectedUpdatedAt(ticket, dto.expectedUpdatedAt);
  // Validate domain-specific rule, then update.
  await audit.write(client, event);
  await outbox.enqueue(client, domainEvent);
});
```

`expectedUpdatedAt` detects a browser that submits a version already stale when the transaction reads it. However, the general `ticket()` read does not use `FOR UPDATE`, and update SQL does not compare `updated_at` in its `WHERE`. Two simultaneous transactions can both pass the check and the later write can overwrite the first. The required hardening is compare-and-update (`WHERE id=$1 AND updated_at=$expected`, zero rows → `409`) or a row lock. Child invariants such as approval decisions do use explicit row locks, and workflow checks prevent illegal status edges. See [mutations and concurrency](tickets/mutations-workflow-and-concurrency.md).

Status changes call `WorkflowDefinitionService.assertTransition`. SLA pause/resume behavior is applied with the transition, and closure can trigger a resolution notice. Automatic assignment takes an advisory lock for the queue so two workers cannot select the same least-loaded assignee at the same instant. Rules support least-loaded and round-robin behavior over configured `queue_members`.

Manual assignment currently validates the supervisor's ticket access, optimistic version and target queue scope, but it does **not** verify that `assigneeId` exists or is an active member of the target queue. The Directory picker reduces accidental bad input but is not a security boundary. The production fix is to query `queue_members`/`staff_directory` in the assignment transaction and reject an inactive or out-of-scope subject before updating the ticket.

## Persistence and emitted evidence

The main tables touched by this module are `tickets` (including assignment and SLA timestamps), `ticket_references`, `ticket_notes`, `ticket_status_history`, `ticket_relationships`, `approval_requests`, `ticket_communications`, `attachments`, `upload_links`, `idempotency_records`, `audit_events`, `integration_outbox` and `notifications`.

Do not put a complete ticket into an audit or live-event payload. Audit metadata records the bounded fact of a change; the outbox carries a stable event id and integration-safe payload; live events carry identifiers that cause an authorized refetch.

## Frontend implementation

[`tickets-page.tsx`](../../apps/web/src/features/tickets/tickets-page.tsx) renders the list and opens [`create-ticket-modal.tsx`](../../apps/web/src/features/tickets/create-ticket-modal.tsx). [`use-ticket-queries.ts`](../../apps/web/src/features/tickets/use-ticket-queries.ts) owns React Query reads, while [`ticket-cache.ts`](../../apps/web/src/features/tickets/ticket-cache.ts) centralizes invalidation.

[`ticket-page.tsx`](../../apps/web/src/features/ticket/ticket-page.tsx) composes the header, sidebar and tabs for activity, attachments, communications, relationships, compliance, retention and audit. Mutating modals send the server version, disable duplicate submission, display a `409` as stale data and invalidate both detail and list keys after success. UI role checks only hide unavailable controls; every API mutation independently enforces permission and scope.

## Failure cases to explain

- `401`: token is absent, invalid or expired.
- `403`: identity is valid but lacks permission, step-up or ticket scope.
- `404`: the resource is absent or deliberately not exposed to this actor.
- `409`: stale version, conflicting idempotency payload or invalid current state.
- `422/400`: DTO or business input is invalid.
- Upload completion succeeds only after object metadata is consistent; download remains blocked until malware status is clean.
- Publishing can fail after the business commit without losing the event because Outbox retries it.

## How to test it

Use unit tests for transition, SLA, assignment and DTO edge cases. Use integration tests for transaction boundaries, duplicate idempotency keys, concurrent updates, inaccessible tickets, maker-checker decisions, attachment state changes and audit/outbox atomicity. The principal suite is [`ticket.integration-spec.ts`](../../apps/api/test/ticket.integration-spec.ts). A two-connection lost-update test should remain red until the current compare/update gap is fixed.

## Interview answer

> I implemented tickets as a transactional aggregate in NestJS. The guarded controller validates transport input and passes the authenticated actor plus correlation id to `TicketsService`. The service loads the current ticket, calls `PolicyService`, checks version/workflow/domain rules, then changes PostgreSQL with audit and outbox in the same transaction. Approval and background claims use locks; automatic assignment is serialized per queue. I would also flag that general optimistic updates currently need an atomic `UPDATE ... WHERE updated_at=expected` fix to close a simultaneous lost-update race.

Continue with the [ticket subsystem index](tickets/README.md), [ticket change and audit](../flows/ticket-change-and-audit.md), [Workflow](workflow.md), [Storage and uploads](storage-and-uploads.md), [Audit](audit/README.md) and [Outbox](outbox.md).
