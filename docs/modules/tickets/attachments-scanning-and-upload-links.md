# Tickets: attachments, scanning and secure upload links

This subsystem combines authorization metadata in PostgreSQL, bytes in S3-compatible storage, malware scanning via ClamAV and customer capability links.

## Staff attachment states

`POST /tickets/:id/attachments` requires ticket update access. Restricted classification additionally requires supervisor role. DTOs allow PDF/JPEG/PNG/text up to 25 MiB for staff; filenames are stripped of slashes/control characters and truncated.

The transaction inserts an attachment with server-generated key `tickets/{ticketId}/attachments/{id}`, audit and outbox. After commit, `AttachmentStorageService.createUploadUrl` returns a short-lived object-specific `PUT`. Storage URL generation is outside the database transaction; a failure leaves metadata pending and the caller can retry/recreate according to UI policy.

Completion locks the attachment row, checks ticket policy and declared size, then stores lowercase SHA-256 and marks `uploaded/pending_scan`. The current completion route trusts the client-declared checksum until the scanner independently hashes actual bytes.

## Scanner worker

[`AttachmentScanWorker`](../../../apps/api/src/tickets/attachment-scan.worker.ts) starts only when ClamAV, object storage and database are configured. Every five seconds it selects up to ten uploaded/pending rows. It does not claim rows before streaming, so multiple API instances can scan the same attachment; the final state method must reject an already completed scan, making duplicate work safe but inefficient. A skip-locked claim/lease would reduce duplicate scanning.

For each row it streams S3 bytes through clamd INSTREAM and calculates SHA-256 over exactly those bytes. A hash mismatch becomes `error` even if malware verdict is clean. It calls `TicketsService.recordAttachmentScan` using a typed `system:attachment-scanner` identity with only `attachment:scan`.

Clean results can be downloaded; malicious/error remain unavailable. Scan transitions write audit/outbox/live evidence. Scanner errors leave pending work for a later pass unless a terminal result was recorded.

## Downloads

`GET /tickets/:id/attachments/:attachmentId/download` requires ticket read access and the attachment to be uploaded and clean. It records `attachment.download_requested` audit/outbox before generating a short-lived GET URL. Object storage sanitizes CR/LF/quotes/backslashes in `Content-Disposition` filename.

## Secure document-request links

[`UploadLinkService`](../../../apps/api/src/tickets/upload-link.service.ts) creates a link row in the same transaction as the communication carrying it. Defaults are 72 hours and five files. Revocation locks the row, rejects duplicate withdrawal and writes evidence.

[`upload-link-token.ts`](../../../apps/api/src/tickets/upload-link-token.ts) signs `upload-link:{uuid}` with HMAC-SHA-256. The public URL stores token after `#`, so browsers do not send it in the HTTP request/proxy log. The portal JavaScript reads the fragment and sends the token only in `X-Upload-Token`.

[`UploadsService`](../../../apps/api/src/uploads/uploads.service.ts) constant-time verifies signature, then checks database link expiry/revocation, approved communication state, ticket open/not redacted and file quota. Every invalid condition returns the same public not-found message. The capability can upload to one ticket; it cannot read notes/ticket detail/other attachments.

Link and signed-in portal uploads delegate to `PortalAttachmentsService`, which uses a narrow `UploadAuthority` to apply ownership/quota/rate rules while sharing the upload state machine.

## Frontend

Staff use `attachments-tab.tsx`; signed-in customers use `documents.tsx`; link holders use `upload-page.tsx`. Both portal paths compute SHA-256 with Web Crypto after `PUT`, call completion and show only mapped states: being checked, received, not accepted.

The link token must never be copied into query parameters, analytics, error messages or logs. Download URLs are opened only from API responses and expire quickly.

## Tests and interview answer

Test classification permission, file bounds/name cleaning, direct upload, completion mismatch, two scanners, clean/malicious/error/hash mismatch, clean-only download, HMAC forgery, fragment/header behavior, expired/revoked/unapproved/closed link equivalence and max files.

> The API stores attachment authority/state but sends bytes directly between browser and object storage using one-object presigned URLs. Completion records the browser hash; a worker independently streams the stored object through ClamAV while hashing actual bytes, and only clean matching content can be downloaded. Document-request links are HMAC capabilities held in the URL fragment then sent as a header, tied to an approved communication, one ticket, expiry and quota.
