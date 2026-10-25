# Customer portal module

The Portal module is the customer-facing boundary for creating and following requests. It intentionally has a different token issuer/audience and a different guard from the staff console. A valid staff token cannot call portal routes, and a portal token cannot satisfy `AuthGuard` on staff routes.

## Backend wiring and API

[`PortalModule`](../../apps/api/src/portal/portal.module.ts) imports Intake and registers [`PortalController`](../../apps/api/src/portal/portal.controller.ts), `PortalService`, `PortalAttachmentsService` and [`PortalAuthGuard`](../../apps/api/src/portal/portal-auth.guard.ts). The portal services are exported for secure-link uploads.

Every response below sets `Cache-Control: no-store`:

| Route | Operation |
|---|---|
| `POST /portal/requests` | Create a request/complaint/correction through Intake |
| `GET /portal/requests` | List only this customer's requests |
| `GET /portal/requests/:id` | Return a customer-safe detail projection |
| `POST /portal/requests/:id/messages` | Add a customer reply |
| `POST /portal/requests/:id/attachments` | Create an upload intent |
| `POST /portal/requests/:id/attachments/:attachmentId/complete` | Confirm upload and queue scanning |

## Identity and ownership

`PortalAuthGuard` verifies the customer JWT using portal-specific OIDC configuration and places a minimal customer principal on `request.customer`. `PortalService` derives the stable customer reference from the token subject and uses it in every lookup. It never trusts a customer id supplied in the body.

List and detail queries join through the customer's `ticket_references` mapping. Detail returns a projection with public reference, status, customer-visible updates and safe attachment states; it does not serialize the staff ticket entity. Missing and not-owned ids have indistinguishable behavior to prevent enumeration.

Portal request creation delegates to `IntakeService`, so channel configuration, routing, SLA, audit, outbox and idempotency are identical to other intake channels. The controller accepts a printable idempotency key up to 100 characters; if absent, it creates one for that request. The frontend supplies a stable key so a retry returns the original ticket.

## Replies and documents

`PortalService.reply` proves ownership before calling `CustomerReplyService`. The reply is stored as a customer-visible note. If a ticket is waiting for the customer, the same transaction returns it to `in_progress`, resumes its SLA clock, appends audit evidence, enqueues an event and notifies the assigned staff audience.

`PortalAttachmentsService` validates MIME type, size, file count and hourly limits. It inserts attachment metadata only after ownership checks, returns a short-lived presigned `PUT` URL, and on completion verifies size/checksum metadata before setting `pending_scan`. The file is shown as “being checked” until the scanner marks it clean. Neither the browser nor the portal API can download an unscanned file.

## Customer frontend

[`apps/portal/src/app.tsx`](../../apps/portal/src/app.tsx) uses a portal-specific OIDC session. It renders sign-in, the new-request form, request history and selected request detail. Plain React state is sufficient because the surface is small; each successful mutation refreshes the list/detail.

[`apps/portal/src/api.ts`](../../apps/portal/src/api.ts) attaches the customer bearer token, signs out on `401`, and converts validated API errors to customer-safe messages. `sendDocument` performs the three-stage upload:

1. Ask the API for an attachment id and presigned URL.
2. Upload bytes directly from the browser to object storage.
3. Calculate SHA-256 in the browser and call the completion route with checksum and size.

The staff application is separate. Staff see the same case through [`ticket-page.tsx`](../../apps/web/src/features/ticket/ticket-page.tsx) after staff policy checks.

## Abuse and failure controls

- Per-subject rate limits bound request, reply and upload abuse.
- UUID parsing rejects malformed identifiers before service logic.
- `no-store` prevents sensitive customer responses from browser/proxy caches.
- Ownership is rechecked on every read and mutation, including attachment completion.
- A presigned URL grants only a short, object-specific upload—not bucket access.
- Duplicate creation is handled by persisted intake idempotency.

## Tests and interview answer

Test separate issuer/audience rejection, cross-customer access, safe projections, duplicate submissions, reply-driven SLA resume, file limits, checksum mismatch and scan gating. The main backend coverage is in [`portal.integration-spec.ts`](../../apps/api/test/portal.integration-spec.ts).

> I implemented the portal as a separate security boundary, not as a weaker staff API. `PortalAuthGuard` validates a customer-specific token and the service derives ownership from its subject. Creation enters the normal Intake transaction, while list, detail, replies and files always join through that customer's reference. The React portal uploads files directly with a one-object presigned URL, confirms size and SHA-256, and displays them only after malware scanning. Staff access uses a different token and policy path.
