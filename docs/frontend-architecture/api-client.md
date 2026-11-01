# API client (`api.ts`)

[Back to Frontend architecture index](README.md) · Code: [apps/web/src/api.ts](../../apps/web/src/api.ts)

---

## 1. One door for all HTTP

The header comment ([L1-L12](../../apps/web/src/api.ts#L1-L12)) states the contract: every call goes through `request()`, which sends the token as a Bearer header (never in a URL), adds a fresh correlation ID, signs out on 401, announces step-up, and throws `ApiError` with the HTTP status. **Screens never call `fetch` directly.**

```ts
export class ApiError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { ... } }   // L62-L64
const authHeaders = (user) => ({ Authorization: `Bearer ${user.access_token}`, 'X-Correlation-Id': crypto.randomUUID() });   // L67
async function request<T>(user, path, init?) {                                                                                  // L79-L83
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...authHeaders(user), ...init?.headers } });
  if (!response.ok) throw await failure(response);
  return response.json() as Promise<T>;
}
```

Thin helpers `post` and `put` ([L84-L85](../../apps/web/src/api.ts#L84-L85)), then **named, typed functions** per endpoint (`createTicket`, `transitionTicket`, `saveWorkflow`...) so components express intent and TypeScript checks request and response shapes.

## 2. Error mapping

[failure, L70-L77](../../apps/web/src/api.ts#L70-L77):

| Status / code | Client behaviour | Who reacts |
|---|---|---|
| 401 | `signOut()`; `ApiError('Your session has expired...')` | session ends |
| 403 + `code: step_up_required` | dispatch `step-up-required` event | `SessionProvider` → banner |
| 403 / 404 | `ApiError` | ticket page shows "not available" for both |
| 409 | `ApiError` (+ `code` e.g. `stale_ticket`) | `useTicketMutation` refetches |
| Validation array | messages joined | toast |
| 5xx / network | `ApiError` / thrown | queries retry up to 2×; mutations never retry |

## 3. Special paths

| Need | Function | Why special |
|---|---|---|
| Paged list with a cursor in a header | `listTicketsPage` [L115-L120](../../apps/web/src/api.ts#L115-L120) | Reads `X-Next-Cursor` |
| CSV download | `downloadComplaintsRegister` [L252-L256](../../apps/web/src/api.ts#L252-L256) | Response is a blob; `saveFile` creates and revokes an object URL ([L88-L91](../../apps/web/src/api.ts#L88-L91)) |
| Audit JSON export | `exportAuditTrail` [L270-L273](../../apps/web/src/api.ts#L270-L273) | Builds a JSON blob from the server response |
| File upload | `uploadAttachment` [L167-L175](../../apps/web/src/api.ts#L167-L175) | PUT to a presigned S3 URL **without** our token + SHA-256 |
| Live stream | `subscribeToLiveEvents` [L191-L224](../../apps/web/src/api.ts#L191-L224) | fetch-based SSE so the token is a header |

## 4. Types

The interfaces mirror the API exactly ([L23-L55](../../apps/web/src/api.ts#L23-L55)), which is why some fields are snake_case (database columns passed through) and some camelCase (computed). The comment admits it ([L36-L39](../../apps/web/src/api.ts#L36-L39)). `TicketListItem` (list and search) is deliberately smaller than `Ticket` (detail).

**TypeScript types are not runtime validation.** They catch our mistakes at compile time, not a server returning something unexpected. Security never depends on a TS interface.

## 5. Runtime config

[config.ts](../../apps/web/src/config.ts): values come from `window.__APP_CONFIG__` (a `/config.js` generated at container start from env), falling back to `VITE_*` at build time. **One image serves every bank and environment.**

## 6. Interview answer

> All HTTP goes through one typed module. It adds the Bearer token and a per-call correlation ID, turns failures into an `ApiError` with status and machine code, signs out on 401, raises a global step-up event on the coded 403, and leaves 403/404/409 handling to callers. Dedicated paths handle the cursor header, blob downloads, presigned uploads (which never carry our token) and header-authenticated SSE.
