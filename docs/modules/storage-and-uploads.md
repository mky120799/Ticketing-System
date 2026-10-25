# Storage and uploads modules

Storage is the provider-neutral object-store adapter; Tickets, Portal and Uploads own the authorization and metadata state machines around it. Browsers receive short-lived access to one object, never reusable storage credentials.

## Module boundaries

[`StorageModule`](../../apps/api/src/storage/storage.module.ts) is global and exports [`AttachmentStorageService`](../../apps/api/src/storage/attachment-storage.service.ts). [`UploadsModule`](../../apps/api/src/uploads/uploads.module.ts) imports Portal and exposes the unauthenticated secure-link controller/service. Staff and signed-in customer uploads remain in Tickets and Portal respectively.

`AttachmentStorageService` creates S3-compatible clients from environment configuration. The internal endpoint can differ from the public signing endpoint, which matters in Docker/Kubernetes. Presigned URL TTL is bounded to 60–900 seconds. The adapter supports signed upload/download, server-side streams, JSON/text report storage and idempotent deletion. If object storage is not configured, it stays metadata-only and never falls back to local disk.

## Upload state machine

All three upload entry points—staff, authenticated customer and secure link—delegate to an authority-aware attachment service and follow the same sequence:

1. Validate actor/link authority, ticket state, MIME allowlist, declared size, file-count/rate limits and filename bounds.
2. Insert an `attachments` row with a generated object key; never accept an object key from the client.
3. Generate a short-lived presigned `PUT` constrained to that key, content type and length.
4. The browser uploads bytes directly to storage.
5. The browser calls completion with size and SHA-256. The service rechecks ownership/link authority and attachment state, then marks it uploaded and `pending_scan`.
6. `AttachmentScanWorker` reads the object as a stream and calls [`scanWithClamd`](../../apps/api/src/storage/clamav.client.ts). The client uses clamd INSTREAM chunks, calculates SHA-256 over the bytes actually scanned and never writes the file to API disk.
7. A clean matching object becomes downloadable; malicious, checksum-mismatched or scanner-error objects remain blocked/are marked accordingly. Audit, outbox and live updates describe the state change without file contents.

Download URLs sanitize `Content-Disposition` filenames and are issued only after ticket policy and clean-scan checks.

## Secure upload links

[`UploadsController`](../../apps/api/src/uploads/uploads.controller.ts) provides `GET /upload/status`, `POST /upload/attachments` and `POST /upload/attachments/:id/complete`. It has no session guard because the HMAC-protected token in `X-Upload-Token` is the capability. Keeping it out of the URL avoids browser history and routine access-log leakage.

[`UploadsService`](../../apps/api/src/uploads/uploads.service.ts) verifies the token and resolves `upload_links` joined with the approved communication and ticket. Expired, forged, revoked, unapproved, closed and redacted cases all return the same not-found response. A valid link can upload only to one ticket, up to `max_files`; it cannot read ticket notes or other documents.

## Frontend

Staff uploads live in [`attachments-tab.tsx`](../../apps/web/src/features/ticket/tabs/attachments-tab.tsx). Authenticated customers use the documents component under [`apps/portal/src/components/documents.tsx`](../../apps/portal/src/components/documents.tsx). The link-only page is [`upload-page.tsx`](../../apps/portal/src/upload-page.tsx). [`apps/portal/src/api.ts`](../../apps/portal/src/api.ts) shows the exact declare → `PUT` bytes → SHA-256 → complete flow.

The frontend maps internal scan states to plain labels such as “being checked”, “received” and “not accepted”. It must never construct an object URL or assume completion means clean.

## Tests and interview answer

Test URL TTL bounds, public/internal endpoints, size/type/count limits, cross-ticket completion, expired/revoked links, identical failure messages, checksum mismatch, malicious verdict, scanner outage and clean-only download. See [`attachment-storage.service.spec.ts`](../../apps/api/test/attachment-storage.service.spec.ts), [`upload-link-token.spec.ts`](../../apps/api/test/upload-link-token.spec.ts) and [`storage.integration-spec.ts`](../../apps/api/test/storage.integration-spec.ts).

> I separated file bytes from authorization metadata. The API validates access and creates an attachment row plus a one-object presigned URL. The browser uploads directly, then confirms size and hash. A worker streams the exact stored object through ClamAV while calculating SHA-256; only a clean matching object can get a presigned download. Secure links are HMAC capabilities sent in a header and restricted to one ticket and a maximum file count.
