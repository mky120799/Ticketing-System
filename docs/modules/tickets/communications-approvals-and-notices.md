# Tickets: communications, approvals and resolution notices

Customer communications are durable governed records. Creating a communication does not mean it was delivered: it may await approval, queue for a worker, move through provider receipts or fail.

## Creation

`POST /tickets/:id/communications` requires ticket update access and rejects redacted or communication-blocked tickets. It selects an active `communication_templates` row matching key/channel and derives `pending_approval` versus `queued` solely from template configuration.

For portal channel, recipient identity is always taken from the ticket's `PORTAL-*` reference; typed client input cannot redirect a portal message. Email/SMS recipient references are stored with a masked presentation value.

If template body includes `{{uploadLink}}`, the service forbids portal channel, requires link configuration and issues the link in the same transaction as the communication. A queued communication sets `first_responded_at`; pending approval does not count until approved.

The transaction inserts `ticket_communications`, optional `approval_requests`, audit events, outbox events and supervisor notification. The API response exposes only masked recipient.

## Generic and communication approvals

`POST /tickets/:id/approvals` creates generic pending work for an action type. Communication templates create a linked approval automatically.

Decision flow locks `approval_requests FOR UPDATE`, then checks ticket `ticket:approve`, step-up and maker-checker (`requested_by !== approver`). Already decided rows return `409`. For linked communication it also locks the communication and requires `pending_approval`, then changes it to `queued` or `rejected`. Approval that queues a communication records the first response.

Approval decision, communication state, audit and outbox commit together. Two supervisors deciding simultaneously serialize on the approval row; one wins and the other sees already decided/no-longer-awaiting state.

## Automatic resolution notice

[`ResolutionNoticeService`](../../../apps/api/src/tickets/resolution-notice.service.ts) runs inside the status-to-resolved transaction. It checks category enablement, redaction, communication block, active channel template, duplicate pending notice and recipient availability.

Portal-origin tickets receive a portal notice. Email-origin tickets reuse a retained `mailto:` communication recipient because inbound sender pseudonym alone is one-way. Other channels use the first opaque customer reference for later CRM resolution.

The notice follows the same approval policy as any communication. Skip reasons are either returned silently when disabled/already pending or audited. Missing template/recipient notifies responsible staff to contact the customer manually; a communication block intentionally avoids such a prompt.

## Delivery and receipts

[`DeliveryWorker`](../../../apps/api/src/email/delivery.worker.ts) claims queued communications with a lease, resolves destination, renders template and calls the provider. Integration receipts deduplicate provider facts and move status monotonically from queued to sent to delivered/failed. See [Email](../email.md) and [Integrations](../integrations.md).

At-least-once processing means template rendering/provider requests must use stable communication ids where possible. UI POST success means “created/queued,” not “delivered.”

## Frontend

[`communications-tab.tsx`](../../../apps/web/src/features/ticket/tabs/communications-tab.tsx) lists masked recipient, channel, template, state and approval action. Capability checks hide supervisor decisions, while the API enforces step-up/maker-checker. After mutation, the shared ticket hook refetches the full communication projection.

Portal detail displays only delivered/customer-visible updates, not pending/rejected internal records. Notification/live events tell staff to refresh rather than exposing communication content.

## Tests and interview answer

Test inactive/mismatched template, communication block, portal recipient override, upload-link template, approval/no approval, self-approval, concurrent decisions, first-response timing, resolution skip reasons, duplicate notice and provider receipt ordering.

> I model communications as durable state, separate from provider delivery. A template decides whether the row is queued or pending approval. Approval locks the request, requires supervisor permission plus step-up, forbids self-approval and atomically advances the linked communication with audit/outbox evidence. Resolution notices reuse the same governed path, and workers/receipts advance delivery asynchronously. The frontend displays queued/delivered state; it never treats creation as delivery.
