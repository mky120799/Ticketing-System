# Email module

The Email module contains two background adapters: inbound mail becomes intake/customer replies, and queued customer communications are delivered outward. It does not expose a public controller; workers use narrowly scoped service identities and durable database state.

## Wiring

[`EmailModule`](../../apps/api/src/email/email.module.ts) imports Intake and Integration. It provides `InboundWorker`, `DeliveryWorker`, a mail provider and `CONTACT_RESOLVER` through a factory. This keeps provider-specific APIs behind interfaces and makes workers testable with fakes.

## Inbound processing

[`inbound.worker.ts`](../../apps/api/src/email/inbound.worker.ts) polls/receives bounded message batches. Before any ticket action it:

1. Rejects oversized or malformed messages and filters automatic replies/loops.
2. Extracts a stable provider message id for idempotency.
3. HMAC-pseudonymizes the sender for matching/logging; raw addresses are not used as log keys.
4. Resolves whether the message is a new request or a reply to an existing customer-owned thread.
5. Calls `IntakeService.create` for new work or `CustomerReplyService` for a proven reply.
6. Marks the provider message processed only after the application operation succeeds; transient failures leave it retryable.

A subject line or guessed ticket reference is not enough to append a reply. The worker must establish that the sender is the contact associated with the ticket, preventing cross-customer note injection.

## Outbound delivery

[`delivery.worker.ts`](../../apps/api/src/email/delivery.worker.ts) claims queued `ticket_communications` using leases so parallel workers do not deliver the same row concurrently. It resolves the current destination through `CONTACT_RESOLVER`, renders the approved template and calls the provider.

On success it records provider identifiers/status. On temporary failure it releases or schedules retry with bounded backoff. Permanent failure reaches a terminal state and produces operational evidence. Provider callbacks enter through the [Integrations](integrations.md) receipt endpoint, which deduplicates receipts and allows only monotonic delivery-state progress.

Delivery is at least once, so the provider request carries a stable communication/event key when supported. The database—not worker memory—is the delivery source of truth.

## Frontend impact

Staff compose or select communication content in [`communications-tab.tsx`](../../apps/web/src/features/ticket/tabs/communications-tab.tsx). Submitting creates a durable communication row; the UI displays queued/sent/delivered/failed state returned by the API. It does not claim delivery merely because the POST succeeded. Customers see eligible delivered messages in portal request history.

## Security, tests and interview answer

- Service identities get only intake/delivery permissions.
- Contact data is resolved only when needed and must not appear in worker logs or outbox metadata.
- Template variables are allowlisted and escaped for their output context.
- Poll batches, message sizes, attachment types and retry counts are bounded.

Test auto-reply suppression, exact redelivery, sender mismatch, new versus reply routing, lease expiry, two competing workers, retry classification and receipt ordering. See [`email.integration-spec.ts`](../../apps/api/test/email.integration-spec.ts).

> I split email into inbound and outbound workers. Inbound messages are normalized and deduplicated by the provider message id, then delegated to Intake or CustomerReply after sender ownership is proven. Outbound communications are durable rows claimed with a lease; a provider call updates delivery state, while callbacks are idempotently reconciled. Because workers can crash, all progress is persisted and every operation is safe to retry.
