# Portal backend

[Back to Portal index](README.md)

---

## 1. Routes

[portal.controller.ts#L10-L20](../../apps/api/src/portal/portal.controller.ts#L10-L20). All use `@UseGuards(PortalAuthGuard)` and `@Header('Cache-Control', 'no-store')`.

| Route | Service | Notes |
|---|---|---|
| `POST /v1/portal/requests` (+ optional `Idempotency-Key`) | `PortalService.create` | Key: ≤ 100 printable chars, otherwise a random UUID is used |
| `GET /v1/portal/requests` | `list` | Newest first, max 100 |
| `GET /v1/portal/requests/:id` | `detail` | `ParseUUIDPipe` |
| `POST /v1/portal/requests/:id/messages` `{ body }` | `reply` | ≤ 5,000 chars |
| `POST /v1/portal/requests/:id/attachments` | `PortalAttachmentsService.createIntent` | [customer documents](../attachments/customer-documents.md) |
| `POST /v1/portal/requests/:id/attachments/:attachmentId/complete` | `complete` | |

DTOs: [portal.dto.ts](../../apps/api/src/portal/portal.dto.ts): `kind ∈ request | complaint | correction`, subject 3-200, description 3-5,000.

## 2. The guard

[portal-auth.guard.ts#L13-L31](../../apps/api/src/portal/portal-auth.guard.ts#L13-L31):

- Not configured → **404** (the portal simply doesn't exist on this deployment).
- `jwtVerify` with `PORTAL_OIDC_ISSUER`, `PORTAL_OIDC_AUDIENCE`, JWKS (`PORTAL_OIDC_JWKS_URI` or `<issuer>/protocol/openid-connect/certs`), RS256/ES256/PS256.
- Requires a non-empty `sub`; sets `request.customer = { subject }` and a correlation ID.
- Any failure → 401.

No roles, no scope: a customer has exactly one right, which is to act on **their own** requests.

## 3. Ownership by reference

[portal.service.ts#L21](../../apps/api/src/portal/portal.service.ts#L21):

```ts
customerReference(subject) { return subject.length <= 200 ? `PORTAL-${subject}` : `PORTAL-${sha256(subject).slice(0, 40)}`; }
```

Every read joins through it, e.g. the detail query ([L44-L46](../../apps/api/src/portal/portal.service.ts#L44-L46)):

```sql
SELECT t.id, t.subject, t.description, t.status, ...
FROM tickets t JOIN ticket_references r ON r.ticket_id = t.id
WHERE t.id = $1 AND r.opaque_reference = $2          -- PORTAL-<my subject>
  AND t.source_channel = 'portal' AND t.redacted_at IS NULL
```

| Condition | Why |
|---|---|
| `opaque_reference = PORTAL-<me>` | Ownership derived from the verified token |
| `source_channel = 'portal'` | A staff-created ticket that happens to reference the customer isn't exposed through the portal |
| `redacted_at IS NULL` | De-identified tickets disappear from the portal |
| No row → **404** | Same answer for "doesn't exist" and "not yours" |

`reply` calls `detail` first purely as an **ownership check** ([L60](../../apps/api/src/portal/portal.service.ts#L60)).

## 4. Creating a request

[create, L23-L34](../../apps/api/src/portal/portal.service.ts#L23-L34):

1. **Rate limit:** count the customer's portal tickets in the last hour; at `PORTAL_MAX_REQUESTS_PER_HOUR` (10) or more → 429.
2. Call `IntakeService.create` as `system:portal` (role `intake-gateway`) with:
   - `messageId = "PORTAL-<subject>:<idempotencyKey>"`, so the customer's retry with the same key returns the same ticket;
   - `senderReference = PORTAL-<subject>`;
   - `category = 'complaint'` for complaints, `'privacy-correction'` for corrections (these categories carry regulatory profiles, so the **clock starts immediately**).
3. Intake not configured (404) → **503** "This service is not available right now. Please contact the bank another way."
4. Returns `{ id, reference: 'CASE-1A2B3C4D', duplicate }`.

**Why delegate to Intake?** One door for every channel: the same de-duplication, routing, SLA, compliance, audit, outbox and auto-assignment.

## 5. The customer-safe projection

[summary L66-L69](../../apps/api/src/portal/portal.service.ts#L66-L69) and [detail L43-L57](../../apps/api/src/portal/portal.service.ts#L43-L57):

| Field | Source | Hidden from the customer |
|---|---|---|
| `reference` | `CASE-` + first 8 hex of the ID | the full UUID is in `id` but harmless |
| `status` | `friendlyStatus`: "received", "waiting for your reply", "being worked on", "resolved", "closed" ([message-template.ts#L4-L13](../../apps/api/src/email/message-template.ts#L4-L13)) | internal codes like `pending_external`, `escalated` |
| `kind` | `correction` / `complaint` / `request` | |
| `complaint.acknowledged`, `finalResponseDueBy` | Regulatory clock (customers are entitled to see it) | internal SLA |
| `updates[]` | Customer-visible notes (`from: you/bank`) + **sent/delivered** portal messages rendered from templates, sorted by time | internal notes, pending/rejected/failed messages |
| `attachments[]` | Only the customer's own uploads, status mapped to being checked / received / not accepted ([customer-attachment-status.ts](../../apps/api/src/portal/customer-attachment-status.ts)) | malware verdict details, staff attachments |

"Scan results are never described: a rejected file just says it was not accepted." This avoids teaching attackers what the scanner catches.

## 6. Replying

[reply, L59-L64](../../apps/api/src/portal/portal.service.ts#L59-L64): ownership check → rate limit (`PORTAL_MAX_MESSAGES_PER_HOUR`, 30) → one transaction calling [CustomerReplyService.add](../intake/customer-replies.md).

## 7. Rate limits summary

| Limit | Env var | Default | Where |
|---|---|---|---|
| New requests | `PORTAL_MAX_REQUESTS_PER_HOUR` | 10 | [L25-L26](../../apps/api/src/portal/portal.service.ts#L25-L26) |
| Messages | `PORTAL_MAX_MESSAGES_PER_HOUR` | 30 | [L61-L62](../../apps/api/src/portal/portal.service.ts#L61-L62) |
| Uploads per hour | `PORTAL_MAX_UPLOADS_PER_HOUR` | 20 | [portal-attachments.service.ts#L69-L72](../../apps/api/src/portal/portal-attachments.service.ts#L69-L72) |
| Documents per request | `PORTAL_MAX_ATTACHMENTS_PER_REQUEST` | 10 | [L63-L64](../../apps/api/src/portal/portal-attachments.service.ts#L63-L64) |
| File size | `PORTAL_MAX_ATTACHMENT_BYTES` | 10 MiB | [L59](../../apps/api/src/portal/portal-attachments.service.ts#L59) |

These are counted in the database, so they work across instances (unlike the in-memory global rate limiter).

## 8. Tests

| Claim | Test |
|---|---|
| Customers raise and follow only their own requests; staff and customer identities stay apart | [portal.integration-spec.ts#L33](../../apps/api/test/portal.integration-spec.ts#L33) |
| Correction request has its own clock and outcomes | [portal.integration-spec.ts#L146](../../apps/api/test/portal.integration-spec.ts#L146) |
| Customer signs in, raises a complaint, follows it and replies (real browser) | [e2e/tests/portal.spec.ts#L4](../../e2e/tests/portal.spec.ts#L4) |

Next: [Frontend](frontend.md)
