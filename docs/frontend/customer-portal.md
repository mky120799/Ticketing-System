# Frontend: customer portal

`apps/portal` is a separate React/Vite application for customers. It has its own OIDC configuration and API boundary; it is not a route inside the staff console.

## Session and app states

[`portal/src/auth.ts`](../../apps/portal/src/auth.ts) configures customer OIDC. [`session.ts`](../../apps/portal/src/session.ts) completes/resumes the session. [`app.tsx`](../../apps/portal/src/app.tsx) renders a loader, customer sign-in or the authenticated portal.

The authenticated page uses plain React state because the surface is small: request summaries, selected detail and feedback. On load it lists requests. Selecting one fetches detail and moves keyboard focus to its heading so screen-reader users hear the context change.

## Main components

- [`new-request-form.tsx`](../../apps/portal/src/components/new-request-form.tsx): request/complaint/correction submission and client validation.
- [`request-history.tsx`](../../apps/portal/src/components/request-history.tsx): only the signed-in customer's safe summaries.
- [`request-detail.tsx`](../../apps/portal/src/components/request-detail.tsx): public status, customer/bank updates, reply and documents.
- [`documents.tsx`](../../apps/portal/src/components/documents.tsx): signed-in file flow.
- [`upload-page.tsx`](../../apps/portal/src/upload-page.tsx): capability-link file flow without account sign-in.

Success/error feedback is in an `aria-live` region; errors use alert semantics. Copy uses customer language rather than internal queue/SLA/status terminology.

## API boundary

[`portal/src/api.ts`](../../apps/portal/src/api.ts) sends the customer access token to `/portal/*`, signs out on 401 and maps validation errors to plain messages. The backend derives customer identity from token subject; requests never send an authority-bearing customer id.

Creation supplies an idempotency key so double click/network retry returns one request. After create/reply/upload, the app refreshes history/detail. Unlike the staff app, the portal currently has no React Query or SSE; it refreshes explicitly after local actions.

## Document upload

Signed-in and link paths use the same three steps: create intent, presigned PUT, local Web Crypto SHA-256 and completion. Client constants mirror 10 MiB and MIME constraints for early feedback, but the backend validates independently.

For secure links, the HMAC token comes from `window.location.hash`, which is not sent to the web server. API calls place it in `X-Upload-Token`, never path/query. Link status exposes request reference, expiry, remaining count and only documents uploaded by that link.

## Security behavior

- Portal/staff issuers and audiences differ.
- API responses are `no-store`.
- Cross-customer ids receive non-enumerating failure.
- Internal notes, assignment, queue, SLA and raw references are absent from the DTO.
- Portal text must not imply an upload was accepted before scan.
- A UI route cannot expand link capability beyond backend resolve checks.

## Interview answer

> I built the customer portal as a separate OIDC application and backend guard. It keeps small local state, lists only subject-owned safe projections and refreshes after create/reply/upload. Creation is idempotent. Files go directly to object storage and are confirmed with SHA-256 before scan. Secure-link tokens live in the URL fragment and are sent in a header, while the link can only upload a bounded number of files to one open request.
