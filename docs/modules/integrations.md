# Integrations module

Integrations receives acknowledgements from external systems for published domain events and outbound customer communications. It reconciles external facts with durable internal rows; it does not let a provider call ticket mutation endpoints directly.

## Wiring and routes

[`IntegrationModule`](../../apps/api/src/integrations/integration.module.ts) imports Auth and Outbox, registers [`IntegrationController`](../../apps/api/src/integrations/integration.controller.ts) and `IntegrationService`, and exports the service for delivery workers.

- `POST /integrations/outbox/:eventId/receipts` requires `integration:reconcile`.
- `POST /integrations/communications/:communicationId/receipts` requires `communication:deliver`.

Provider/service tokens pass through the normal `AuthGuard`; they receive dedicated roles/permissions rather than administrator rights.

## Outbox receipt algorithm

[`IntegrationService.recordReceipt`](../../apps/api/src/integrations/integration.service.ts) locks the target `integration_outbox` row. Only a `published` event may be acknowledged. The unique logical key is event plus external system:

- no prior receipt: insert `integration_receipts` and audit the reconciliation;
- exact replay: return the stored receipt with `replayed: true`;
- same key but different external reference, outcome or payload hash: return `409 Conflict`.

This prevents an integration retry from duplicating evidence while detecting contradictory claims.

## Communication receipt algorithm

The service locks `ticket_communications`, rejects records still pending approval/rejected, validates failure-code rules and deduplicates by communication, provider, provider message id and status. Delivery progression is monotonic: queued can become sent, delivered or failed; delivered/failed terminal records cannot move backwards.

After inserting `communication_delivery_receipts`, it advances the communication only when the new rank is higher, writes audit evidence and enqueues `customer_communication.delivery_updated` in the same transaction. Exact provider redelivery returns the existing receipt.

## Frontend and operations

There is no browser-facing provider callback. Staff see reconciled status in [`communications-tab.tsx`](../../apps/web/src/features/ticket/tabs/communications-tab.tsx), and administrators inspect integration/outbox health in [`integration-section.tsx`](../../apps/web/src/features/admin/sections/integration-section.tsx). The UI displays database state after refetch, not a provider callback payload.

## Tests and interview answer

Test unpublished events, exact replay, conflicting replay, two concurrent receipts, invalid failure codes, pending-approval communication and backward delivery transitions. Kafka publication behavior is covered by [`kafka.integration-spec.ts`](../../apps/api/test/kafka.integration-spec.ts).

> I implemented provider callbacks as idempotent reconciliation commands. The service authenticates a narrow machine identity, locks the durable event or communication, checks that the transition is legal, and inserts a receipt under a unique business key. Exact retries return the previous result; contradictory retries conflict. Communication status only moves forward, and its audit/outbox records are committed atomically.
