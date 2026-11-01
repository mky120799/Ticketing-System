# Portal frontend (`apps/portal`)

A small React + Mantine app for the public. It is tuned for plain language, readability and accessibility, and it deliberately keeps state simple.

[Back to Portal index](README.md)

---

## 1. Files

| File | Job |
|---|---|
| [main.tsx](../../apps/portal/src/main.tsx#L20) | Two pages by path: `/upload` → `UploadPage` (no account), anything else → `App` |
| [config.ts](../../apps/portal/src/config.ts) | Runtime `/config.js` values (one image for every bank) |
| [auth.ts](../../apps/portal/src/auth.ts) | Customer `UserManager` (code + PKCE, sessionStorage, silent renew) |
| [session.ts](../../apps/portal/src/session.ts) | `usePortalSession`: finish callback, remove `?code` from the URL, renew/expire |
| [api.ts](../../apps/portal/src/api.ts) | `call()` with the Bearer token; `callLink()` with `X-Upload-Token` |
| [app.tsx](../../apps/portal/src/app.tsx) | Sign-in page, portal layout, feedback region |
| [components/new-request-form.tsx](../../apps/portal/src/components/new-request-form.tsx) | Request / complaint / correction |
| [components/request-history.tsx](../../apps/portal/src/components/request-history.tsx) | The customer's requests |
| [components/request-detail.tsx](../../apps/portal/src/components/request-detail.tsx) | Status, complaint clock, conversation, reply, documents |
| [components/documents.tsx](../../apps/portal/src/components/documents.tsx) | Document list and upload form (shared with the upload page) |
| [upload-page.tsx](../../apps/portal/src/upload-page.tsx) | Secure-link page |
| [theme.ts](../../apps/portal/src/theme.ts) | Brand colours with WCAG-AA contrast overrides, 17 px body text |

## 2. Session

[session.ts#L9-L39](../../apps/portal/src/session.ts#L9-L39) mirrors the staff `SessionProvider`, but is simpler:

- Callback completed once (cached promise, [auth.ts#L12-L13](../../apps/portal/src/auth.ts#L12-L13)).
- `window.history.replaceState` removes `?code=...` so a refresh doesn't try to reuse a one-time code ([L20](../../apps/portal/src/session.ts#L20)).
- Silent renew updates the user; expiry signs out.
- No `/me`, no roles: the portal has one kind of user.

## 3. State management: deliberately simple

The comment in [app.tsx#L12](../../apps/portal/src/app.tsx#L12): "The portal is small, so it keeps its data in plain React state rather than a query cache." It refreshes explicitly after each action:

```ts
const refresh = useCallback(() => { void listRequests(user).then(setRequests).catch(fail); }, [user, fail]);
const open = useCallback(async (id) => { setSelected(await getRequest(user, id)); setTimeout(() => heading.current?.focus(), 0); }, ...);
```

**Trade-off:** no React Query and no SSE means customers see staff updates when they reopen or refresh. That's fine for a low-frequency public surface, and it keeps the bundle small.

## 4. Creating a request

[new-request-form.tsx#L16-L55](../../apps/portal/src/components/new-request-form.tsx#L16-L55):

```ts
const submissionKey = useRef(crypto.randomUUID());
const created = await createRequest(user, { kind, subject, description }, submissionKey.current);
submissionKey.current = crypto.randomUUID();     // the NEXT request is a new submission
```

**Plain:** if the network drops and the customer presses Send again, the same key goes with it, so the bank gets one request. After success, a fresh key is generated. The confirmation includes the reference "Your reference is CASE-1A2B3C4D."

The form text warns: "Please do not include full card numbers, passwords or PINs."

## 5. Request detail

[request-detail.tsx#L14-L84](../../apps/portal/src/components/request-detail.tsx#L14-L84):

- Reference + friendly status badge.
- **Complaint clock** for complaints and correction requests: "We have acknowledged your complaint. You will receive our final response by 24 November 2026." (a regulatory duty, [L44-L49](../../apps/portal/src/components/request-detail.tsx#L44-L49)).
- "What you told us", then an "Updates" conversation (you on the right in green, the bank on the left in blue).
- Reply form, document list, document upload.

## 6. Documents

[documents.tsx#L36-L63](../../apps/portal/src/components/documents.tsx#L36-L63) checks type and size first for a friendly message ([L44-L45](../../apps/portal/src/components/documents.tsx#L44-L45)), then calls `sendDocument` ([api.ts#L25-L32](../../apps/portal/src/api.ts#L25-L32)): declare → PUT bytes straight to object storage → compute SHA-256 with Web Crypto → complete. "Received" appears only after the malware scan. Details: [customer documents](../attachments/customer-documents.md).

## 7. Accessibility choices (worth mentioning)

| Choice | Code |
|---|---|
| Opening a request moves keyboard focus to its heading (`tabIndex=-1`) | [app.tsx#L64-L67](../../apps/portal/src/app.tsx#L64-L67), [request-detail.tsx#L39](../../apps/portal/src/components/request-detail.tsx#L39) |
| Feedback in an `aria-live` region; errors use `role="alert"` | [app.tsx#L91-L98](../../apps/portal/src/app.tsx#L91-L98) |
| `aria-current` on the open history item | [request-history.tsx#L18](../../apps/portal/src/components/request-history.tsx#L18) |
| Native file input so labels work on every phone | [documents.tsx#L54-L57](../../apps/portal/src/components/documents.tsx#L54-L57) |
| Contrast-safe colour overrides, 17 px body | [theme.ts](../../apps/portal/src/theme.ts) |

The e2e tests run axe accessibility checks ([e2e/README.md](../../e2e/README.md)).

## 8. Interview answer

> The portal is its own small React app with its own OIDC client. It uses code + PKCE, removes the one-time code from the URL, and needs no role logic. It keeps plain React state and refreshes after each action. New requests carry an idempotency key that is kept across retries and regenerated after success. The detail view shows friendly statuses, the regulatory final-response date and a conversation. Documents go straight to object storage with a SHA-256 confirmation and show "received" only after scanning. Focus management and live regions make it usable with screen readers.
