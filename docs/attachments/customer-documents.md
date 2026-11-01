# Customer documents (portal and links)

Customers follow the **same** upload state machine as staff, plus what a public door needs: proof of who may upload, tighter limits, and a customer reply on the ticket so staff react.

[Back to Attachments index](README.md) · Code: [portal-attachments.service.ts](../../apps/api/src/portal/portal-attachments.service.ts)

---

## 1. `UploadAuthority`: one shape, two kinds of caller

[L21-L28](../../apps/api/src/portal/portal-attachments.service.ts#L21-L28):

```ts
interface UploadAuthority {
  ticketId: string;
  actor: 'customer:portal' | 'customer:link';
  hourlyReference?: string;                 // portal: PORTAL-<subject>, for the hourly limit
  link?: { id: string; maxFiles: number };  // link: which link, how many files it allows
}
```

| Caller | Proves authority by | Builds authority in |
|---|---|---|
| Signed-in portal customer | Owning the request (reference join), request open | `authorise()` [L42-L48](../../apps/api/src/portal/portal-attachments.service.ts#L42-L48) |
| Link holder (no account) | A genuine, current, approved link | `UploadsService.resolve()` ([secure-upload-links.md](secure-upload-links.md)) |

After that, both call the same `issue()` and `finish()`. **Plain:** two different keys open the same locker room; once inside, the rules are identical.

## 2. `issue()`: create the intent

[L58-L84](../../apps/api/src/portal/portal-attachments.service.ts#L58-L84):

| Check | Result if it fails |
|---|---|
| Size ≤ `PORTAL_MAX_ATTACHMENT_BYTES` (10 MiB) | 413 Payload Too Large |
| Filename cleaned, non-empty | 409 |
| ≤ `PORTAL_MAX_ATTACHMENTS_PER_REQUEST` (10) customer files on this ticket | 409 |
| Link: ≤ `link.maxFiles` files via this link | 409 "This link allows up to N documents" |
| Portal: ≤ `PORTAL_MAX_UPLOADS_PER_HOUR` (20) by this customer | 429 |
| Storage configured | 503 "Please bring them to a branch or contact us another way" |

Then the presigned URL is signed **before** the transaction (no URL means no row), the `attachments` row is inserted with `classification='confidential'`, `uploaded_by = customer:portal|link` and `upload_link_id`, plus audit (`source: portal|link`) and outbox.

## 3. `finish()`: complete

[L86-L99](../../apps/api/src/portal/portal-attachments.service.ts#L86-L99):

```sql
SELECT ... FROM attachments
WHERE id=$1 AND ticket_id=$2 AND uploaded_by=$3 AND upload_link_id IS NOT DISTINCT FROM $4 FOR UPDATE
```

The completion must come from **the same kind of caller and the same link** that created it. A portal customer can't complete a link upload, and vice versa. `IS NOT DISTINCT FROM` compares NULLs correctly (a portal upload has `upload_link_id = NULL`).

Then: not already sent; size matches; mark `uploaded` / `pending_scan`; audit + outbox; and **`CustomerReplyService.add(... "The customer attached a document: x.pdf")`**, so the ticket gets a customer note, a waiting ticket moves to in progress, the SLA resumes, and the assignee is notified ([customer replies](../intake/customer-replies.md)).

Response: `{ id, status: 'being_checked' }`.

## 4. What the customer sees

[customer-attachment-status.ts#L2-L4](../../apps/api/src/portal/customer-attachment-status.ts#L2-L4):

| Internal `malware_status` | Customer sees |
|---|---|
| `pending_scan` | "Being checked" |
| `clean` | "Received" |
| `malicious` / `scan_error` | "Not accepted. Please send a different file or contact us." |

Scan verdicts are **never described**, so attackers can't use the portal as a free antivirus oracle. Customers can't download files back.

## 5. Interview answer

> Customer uploads reuse the staff state machine through an `UploadAuthority` object built either from portal ownership or from a verified link. The shared `issue` and `finish` enforce size, per-request, per-link and hourly limits, require the completion to come from the same authority, and turn a completed upload into a normal customer reply, so the SLA, status and staff notifications react. Customers only ever see "being checked", "received" or "not accepted".

Next: [Secure upload links](secure-upload-links.md)
