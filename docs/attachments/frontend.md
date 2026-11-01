# Attachments frontend

Three UIs share one pattern: **declare → PUT to storage → hash → complete**.

[Back to Attachments index](README.md)

---

## 1. The shared upload code

Staff, [api.ts#L167-L175](../../apps/web/src/api.ts#L167-L175):

```ts
const intent = await post(user, `/tickets/${ticketId}/attachments`, { filename: file.name, contentType: file.type, sizeBytes: file.size, classification });
if (!intent.storageConfigured || !intent.uploadUrl) return { stored: false };
const bytes = await file.arrayBuffer();
const upload = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: bytes });  // straight to S3
if (!upload.ok) throw new Error('Upload to object storage failed');
await post(user, `/tickets/${ticketId}/attachments/${intent.id}/complete`, { checksumSha256: await sha256Hex(bytes), sizeBytes: file.size });
```

`sha256Hex` ([api.ts#L94-L96](../../apps/web/src/api.ts#L94-L96)) uses **Web Crypto** (`crypto.subtle.digest('SHA-256', bytes)`), built into browsers, with no library and no upload of the hash secret.

Customers: [portal api.ts#L25-L32](../../apps/portal/src/api.ts#L25-L32) (signed-in) and [L42-L49](../../apps/portal/src/api.ts#L42-L49) (link, `X-Upload-Token`).

**Note:** the PUT to storage does **not** carry the bearer token. The presigned URL is the authorisation, so our token never goes to the storage host.

## 2. Staff attachments tab

[attachments-tab.tsx#L19-L94](../../apps/web/src/features/ticket/tabs/attachments-tab.tsx#L19-L94):

| Feature | Detail |
|---|---|
| Table | File, classification, size (`formatBytes`), scan badge (Scanning / Clean / Blocked: malware / Scan failed, [labels.ts#L55-L59](../../apps/web/src/lib/labels.ts#L55-L59)), added |
| Download button | Only when `malwareStatus === 'clean'`; opens the short-lived URL in a new tab with `noopener` ([L27-L31](../../apps/web/src/features/ticket/tabs/attachments-tab.tsx#L27-L31)) |
| Upload form | Native `<input type=file>` with accept list; classification "Restricted (supervisors only)" offered only to supervisors |
| After upload | "Uploaded. The file stays unavailable until malware scanning completes." |
| Mutation | `useTicketMutation`, so the ticket is refetched and the new row appears as "Scanning" |

When the scan finishes, the change appears on the next refetch (SSE hints are sent for ticket changes; scan results update the attachment, and the next live or manual refresh shows "Clean").

## 3. Portal documents

[documents.tsx](../../apps/portal/src/components/documents.tsx): client-side type and size checks for friendly errors; list with plain-language statuses; the same component is used on the signed-in detail page and the link page.

## 4. Secure-link page

[upload-page.tsx#L13-L60](../../apps/portal/src/upload-page.tsx#L13-L60):

```ts
const token = window.location.hash.slice(1);   // read the fragment; never put it in a URL we request
```

- Loads `GET /upload/status`; any error shows one plain message ("This link is not valid or has expired").
- Shows the reference, expiry, remaining count and the customer's documents.
- Hides the upload form when `remaining === 0`.
- Hint text: "Please cover or leave out full card numbers and PINs. The bank will never ask for your PIN or password."

## 5. Interview answer

> All three UIs declare the file, PUT it directly to object storage with the presigned URL (no bearer token goes to storage), compute SHA-256 with Web Crypto and confirm. Staff see scan badges and can download only clean files through short-lived URLs; customers see "being checked / received / not accepted". The link page reads its token from the URL fragment and sends it only as a header.

Next: [Interview Q&A](interview-qa.md)
