# Intake module

Intake normalizes inbound work from portal, email and other configured channels into the same ticket-creation pipeline. Its two invariants are: one external message produces at most one ticket, and channel adapters receive only the authority needed to submit normalized input.

## Wiring and endpoint

[`IntakeModule`](../../apps/api/src/intake/intake.module.ts) imports Auth and Tickets, registers [`IntakeController`](../../apps/api/src/intake/intake.controller.ts), `IntakeService` and `CustomerReplyService`, and exports both services for Portal and Email.

`POST /intake/:channel` is guarded by `AuthGuard`, accepts only values declared in `INTAKE_CHANNELS`, and returns `200` on both first delivery and valid redelivery. Channel adapters authenticate as a narrow `intake-gateway` service identity; they are not impersonated human agents.

## New-message algorithm

[`IntakeService`](../../apps/api/src/intake/intake.service.ts) performs the following transaction:

1. Assert `intake:create` and validate the adapter's scope.
2. Load enabled `intake_channels` configuration for the route.
3. Normalize and hash the incoming message fields.
4. Look up `(channel, messageId)` in `intake_messages`. If its stored hash matches, return the original ticket. If the id matches but content differs, reject the collision.
5. Validate the configured queue/category/legal-entity selection.
6. Insert `tickets`, `ticket_references` and the durable intake-message record.
7. Start SLA clocks, classify compliance concerns, append audit evidence and enqueue the ticket-created event with the same transaction client.
8. Run configured assignment and emit a minimal live signal after commit.

This is stronger than an in-memory duplicate check: multiple adapter instances can redeliver after a timeout without creating two cases.

## Customer replies

`CustomerReplyService` is shared by Portal and inbound Email. It locks and authorizes the target ticket, inserts a customer-visible note and, when status is `pending_customer`, transitions it back to `in_progress`. SLA resume, audit, outbox, workflow and staff notification happen in the same logical operation.

The service accepts a resolved ticket/customer relationship; an adapter may not attach arbitrary text by knowing only a ticket UUID. Email additionally proves sender ownership, and Portal derives it from the authenticated subject.

## Frontend and administration

Customers submit through [`new-request-form.tsx`](../../apps/portal/src/components/new-request-form.tsx). Staff configure channel enablement and routing under [`intake-section.tsx`](../../apps/web/src/features/admin/sections/intake-section.tsx). The browser never calls the service-identity endpoint; it uses `/portal/requests`, whose backend delegates internally to Intake.

## Failures, tests and interview answer

Test unknown/disabled channels, insufficient service permissions, first delivery, exact redelivery, message-id hash collision, invalid routing configuration, transaction rollback and concurrent delivery. Also prove that a customer reply resumes SLA only from the expected workflow state.

> I implemented Intake as an adapter boundary. Email and portal normalize their input, but `IntakeService` owns idempotency, routing and ticket creation. It persists channel plus external message id and a request hash, so retries across replicas return the existing ticket and conflicting reuse is rejected. Ticket rows, SLA state, audit evidence and the outbox event are committed atomically; assignment and live notification follow the committed record.

See [Portal](portal.md), [Email](email.md), [Tickets](tickets.md) and the [event catalogue](../product/events.md).
