# Audit module: frontend implementation

The audit frontend is a read/search/verification client. It never constructs audit truth from browser state and never verifies only the currently displayed subset as if that proved the whole chain.

## Main surfaces

- [`audit-page.tsx`](../../../apps/web/src/features/audit/audit-page.tsx) displays chain status, anchor information, scoped event search and verification controls.
- [`audit-tab.tsx`](../../../apps/web/src/features/ticket/tabs/audit-tab.tsx) requests the authorized report for one ticket.
- [`api.ts`](../../../apps/web/src/api.ts) defines typed audit requests/responses.
- [`query-keys.ts`](../../../apps/web/src/lib/query-keys.ts) separates chain, search and ticket-report caches.
- [`person-name.tsx`](../../../apps/web/src/components/person-name.tsx) resolves opaque actor subjects for display while preserving ids in evidence/detail.

## Search flow

The page sends bounded filters—actor, action prefix, outcome, date range and cursor—to `/audit/events`. PostgreSQL applies auditor legal-entity/country/queue scope before returning a page. `nextBefore` becomes the next sequence cursor. Changing filters creates a distinct query key and discards the old pagination chain.

The UI displays timestamp, actor subject/name, action, target, outcome, correlation id and event hash. Metadata is rendered as bounded evidence, not injected as HTML. Correlation id lets an investigator connect several actions from one request across event types.

## Verification and export

Chain status distinguishes never-verified, valid and invalid. Running verification is an explicit mutation; after success the client invalidates chain-status queries. A full verification can be slower and should show progress/pending state without issuing duplicates.

Ticket report export calls the server route rather than exporting whatever page happens to be cached. If the API returns `step_up_required`, the shared session layer opens the reauthentication banner and preserves the return path. The retried action receives a new token; the old failed response is not treated as export success.

## Authorization and caching

Navigation is shown only for the frontend `viewAudit` capability, but direct routing still calls the API and handles `403`. Query data is cleared with logout and must not be reused across users. Audit/export responses use deliberately conservative caching because they may reveal operational security facts even without customer content.

## Interview answer

> The audit UI sends filters and pagination to a server-side scoped search; it does not download all events or filter in React. It shows opaque actor ids plus Directory names, correlation ids and hashes. Verification is a server command that updates chain status, and export calls a dedicated step-up-protected endpoint rather than serializing the visible table. Frontend role checks improve navigation only—the API enforces `audit:read` and ticket scope.
