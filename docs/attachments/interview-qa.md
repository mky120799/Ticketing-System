# Attachments interview Q&A

[Back to Attachments index](README.md)

---

## 30 seconds
> Bytes never pass through the API. It authorises, records metadata with a server-chosen key and returns a short-lived presigned PUT. The browser uploads directly and confirms size and SHA-256. A worker streams the stored object through ClamAV while re-hashing it, so only clean, matching files get an audited, short-lived download URL. Customers share the state machine with tighter limits, and account-less callers use HMAC links kept in the URL fragment.

## Questions

**Q1. Why presigned URLs instead of uploading through the API?**
> It keeps large bodies off the API (the body limit is 1 MiB), avoids buffering customer files on API servers, scales with the storage service, and the URL is limited to one key, one method, a content type and length, and minutes of validity.

**Q2. Can a client overwrite someone else's file?**
> No. The server picks the key `tickets/<ticketId>/attachments/<uuid>` and signs exactly that key.

**Q3. The browser sends the checksum. Can't it lie?**
> It can, so we don't trust it alone. The scanner hashes the bytes it actually scanned; a mismatch becomes `scan_error` and is never released.

**Q4. Why stream to ClamAV instead of downloading first?**
> No temporary copies of customer documents on disk, constant memory, and the hash is computed over exactly the scanned bytes.

**Q5. What if two scanners process the same file?**
> The result method locks the row and accepts only the first result; the second gets "already completed". It's safe, but wasted work, so I'd add a skip-locked claim.

**Q6. Why `Content-Disposition: attachment` on downloads?**
> So a malicious HTML or SVG is downloaded, not rendered in a context where it could run script.

**Q7. How do secure links stay secret?**
> HMAC tokens not stored in the DB, carried in the URL fragment (never sent to servers or logs), sent to the API as a header, verified in constant time, and checked against DB state, with the same 404 for every failure.

**Q8. What does a link let someone do?**
> Upload up to N files to one open request while the link is valid. It can't read the request, its notes or other documents.

**Q9. Why does a customer upload create a reply?**
> So the case reacts like any customer message: a note, status back to in progress, SLA resumed, assignee notified.

## Limitations
1. No claim or lease in the scan worker.
2. The staff UI doesn't auto-refresh exactly when a scan completes (it relies on the next refresh or event).
3. Email attachments aren't imported.
4. Presigned PUTs can't enforce content beyond declared type and length; scanning is the real gate.
