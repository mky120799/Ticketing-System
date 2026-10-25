# Frontend API client and data flow

[`apps/web/src/api.ts`](../../apps/web/src/api.ts) is the typed HTTP boundary. Screens/hooks do not call `fetch` directly except the API module's special streaming/blob/presigned-upload implementations.

## Shared request path

`request<T>(user, path, init)` combines runtime API base URL, JSON content type, the OIDC access token and a fresh browser-generated `X-Correlation-Id`. It parses successful JSON to a declared TypeScript shape and sends failures through one handler.

The correlation id is not security; it lets one click be connected across audit/outbox/log records. The backend bounds or replaces it.

Thin helpers (`post`, `put`) eliminate repeated method/body code. Named functions such as `transitionTicket` or `saveWorkflow` preserve domain intent and provide compile-time request/response contracts.

## Error behavior

`ApiError` contains readable message, HTTP status and optional machine code.

- `401`: starts sign-out and returns a session-expired error.
- structured `step_up_required`: dispatches a browser event; `SessionProvider` shows the shared reauthentication banner.
- `403`: components show unavailable/no permission according to context.
- `404`: ticket detail deliberately groups with 403 to avoid confirming existence.
- `409`: ticket mutation hook refreshes authoritative data; current message explains stale/conflict.
- `5xx`/network: queries may retry according to QueryClient policy; mutations never retry automatically.

The API attempts to parse JSON errors and joins validation message arrays. It never displays raw Response/stack/database detail.

## Special response paths

- Ticket list uses direct `fetch` to read `X-Next-Cursor` while body remains an array.
- CSV complaints report and audit JSON export create a temporary object URL/download link, then revoke it.
- Attachments call API for intent, `PUT` bytes to presigned storage URL, hash bytes with Web Crypto, then call completion.
- SSE uses `fetch` instead of native `EventSource` so bearer token travels in an Authorization header rather than URL/query.

## Type boundaries

`TicketListItem` is deliberately smaller than full `Ticket`. Detail adds notes, history, attachments, references, communications, relationships, retention and allowed transitions. Search returns minimal list fields. Components should not assume a list row contains nested data.

Some ticket properties mirror database-style names while computed fields are camelCase. This inconsistency is documented in the type but increases UI mistakes; a future API mapper should expose one naming convention and schema-generated client types.

TypeScript is not runtime validation. The API can still return an unexpected shape; critical clients should validate with a runtime schema. Security never depends on a TypeScript interface.

## React Query policy

[`query-client.ts`](../../apps/web/src/lib/query-client.ts) uses 30-second stale time and disables focus refetch because SSE handles prompt changes. Queries retry fewer than two times only for network/server failures; 4xx is not retried. Mutations never retry automatically because many commands need deliberate idempotency/current-version handling.

Global `MutationCache.onError` sends one toast unless a mutation opts into local silent handling.

[`query-keys.ts`](../../apps/web/src/lib/query-keys.ts) builds hierarchical keys. Invalidating `['ticket', id]` reaches detail/audit descendants; invalidating `['tickets']` reaches every list/search. Configuration keys include resource and scope argument.

## Logout/cache isolation caveat

User-specific server data must not survive into another user's session. The architecture should clear `QueryClient` on sign-out/user-subject change. If current sign-out relies only on redirect/page reload, that works operationally but should be covered by an explicit cache-clear test and implementation to avoid same-page account switching leakage.

## Interview answer

> I centralize HTTP in a typed API module that attaches the current access token and correlation id, maps 401/403/404/409 distinctly and raises structured step-up globally. Blob downloads, cursor headers, presigned uploads and authenticated SSE have dedicated paths. React Query retries reads only for transient failures, never mutations, and hierarchical keys make invalidation predictable. Types improve development, while backend validation/authorization remains the runtime boundary.
