# Flow: customer portal request and reply

## Create request

1. Customer OIDC session is established in `apps/portal`; `NewRequestForm` collects kind, subject and description.
2. `api.ts` posts `/v1/portal/requests` with customer bearer token and idempotency key.
3. `PortalAuthGuard` validates customer issuer/audience/JWKS and creates `request.customer.subject`.
4. `PortalService.create` maps subject to a stable `PORTAL-*` reference and normalizes the portal message.
5. `IntakeService.create` validates enabled portal channel, durable `(channel,messageId,hash)` idempotency, configured category/queue and routing.
6. One transaction inserts ticket/reference/intake message, calculates SLA, applies compliance, writes audit/outbox, auto-assigns and queues commit-time live notification.
7. Portal receives public ticket id/reference; it refreshes history and detail.
8. Staff receive list/live/notification updates but still refetch through staff policy.

## Reply to a waiting ticket

1. `RequestDetail` posts `/portal/requests/:id/messages`.
2. Portal service queries the id through the authenticated customer's reference, proving ownership.
3. `CustomerReplyService` locks/processes the ticket and inserts a customer-visible note.
4. If status was `pending_customer`, it transitions to `in_progress` and resumes SLA deadlines by paused duration.
5. Audit, outbox, live and staff notification records are created.
6. Portal refreshes detail; staff clients receive a hint and refetch.

## Failure reasoning

- Staff token at portal guard or customer token at staff guard: authentication failure.
- Customer guesses another UUID: non-enumerating not-found behavior.
- Duplicate create with same key/hash: original ticket; same key/different body: conflict.
- Reply after ownership/status change: service rechecks authoritative data.
- SSE loss: staff eventually recovers through resync/manual query; portal refreshes after its own action.

## Interview answer

> The customer UI uses a separate OIDC audience. The portal controller never accepts a customer id; it derives ownership from the verified subject. New work delegates to Intake so idempotency, routing, SLA, audit, outbox and assignment match other channels. Replies re-prove ownership, add a customer note and atomically resume a pending-customer SLA before notifying staff.
