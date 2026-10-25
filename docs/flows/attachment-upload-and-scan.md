# Flow: attachment upload, scan and download

1. Staff/customer selects a bounded allowed file. Frontend sends metadata—not bytes—to the relevant intent endpoint.
2. Guard/capability resolver proves authority. Service generates attachment UUID/object key and inserts pending metadata with audit/outbox.
3. Storage adapter returns a 60–900 second presigned PUT constrained to object key/type/length.
4. Browser PUTs bytes directly to S3-compatible storage.
5. Browser computes SHA-256 of those bytes and posts completion with hash/size.
6. Completion rechecks authority and locks attachment, verifies declared size/state, then stores hash and marks `uploaded/pending_scan`.
7. Scan worker selects a bounded pending batch, streams stored bytes to clamd and independently computes SHA-256.
8. Hash mismatch becomes error; clamd returns clean/malicious/error. Worker calls the same protected ticket method as an external scanner identity.
9. Scan transaction updates status and writes audit/outbox/live evidence.
10. UI refetch maps state. Only clean files can request a short-lived presigned GET; that access is also audited.

## Retry/concurrency

- Intent committed but URL generation failed: metadata remains pending; no unrestricted fallback.
- Browser PUT succeeded but completion failed: safe to retry completion subject to state checks.
- Multiple workers may scan same row because selection has no claim lease; duplicate finalization is rejected/retried safely but wastes work.
- Scanner/storage outage leaves pending rows and raises pending-age metrics.
- Presigned URL expiry requires a new controlled intent/path, never static credentials.

## Interview answer

> I keep file bytes outside the API. The API owns authorization and metadata, returns a one-object presigned PUT, then records browser size/hash. A worker streams the stored bytes through ClamAV while independently hashing them. Only a clean matching object receives a short-lived download URL, and every state transition is audited and published without putting file content in events.
