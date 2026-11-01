# How the directory works

[Back to Directory index](README.md) · Code: [directory.service.ts](../../apps/api/src/directory/directory.service.ts)

---

## 1. Why IDs, not names

| Stored as | Why |
|---|---|
| `tickets.assigned_to`, `created_by`, `audit_events.actor_id`, `queue_members.user_id` = **subject ID** | Never changes, never reused, unique even when two people share a name |
| Names | Live only in `staff_directory`, refreshed over time |

A rename changes future display **without rewriting evidence**.

## 2. Table

`staff_directory(subject PK, display_name, username, email, legal_entity, country, queues text[], roles text[], last_seen_at)` with an index on `(legal_entity, country)`. Staff names only, never customer data ([migration comment](../../apps/api/migrations/1710000030000_staff_directory.cjs#L2-L5)). A bank can feed the same table from its HR system (e.g. SCIM).

## 3. `record(user)`: on every `/me`

[L22-L37](../../apps/api/src/directory/directory.service.ts#L22-L37): skip service identities (shown as "Automatic"); `INSERT ... ON CONFLICT (subject) DO UPDATE` with the name, username, email, scope, queues and roles from the verified token; catch and log any error. **Names are a convenience: a directory failure must never stop someone signing in** ([L34](../../apps/api/src/directory/directory.service.ts#L34)).

## 4. `lookup(user, subjects)`

`POST /v1/directory/lookup` `{ subjects: string[] }` ([controller L16](../../apps/api/src/directory/directory.controller.ts#L16)):

- DTO: array of ≤ 200 strings, 1-160 characters each ([L7](../../apps/api/src/directory/directory.controller.ts#L7)).
- **POST, not GET**, so a long list of IDs never ends up in a URL or access log ([comment L15](../../apps/api/src/directory/directory.controller.ts#L15)).
- Caller must be staff (case roles or administrators), not a machine identity ([assertStaff L65-L67](../../apps/api/src/directory/directory.service.ts#L65-L67)).
- SQL limited to the caller's **legal entity and country** ([L42-L45](../../apps/api/src/directory/directory.service.ts#L42-L45)); unknown or out-of-scope IDs are simply omitted.
- Returns `{ subject: name }`.

## 5. `people(user, queue?)`: assignee pickers

`GET /v1/directory/people?queue=payments` ([L53-L62](../../apps/api/src/directory/directory.service.ts#L53-L62)):

- Needs `ticket:assign` (supervisors) or `configuration:write` (administrators).
- Same entity and country; only people with `case-agent` or `supervisor` roles (`roles && ARRAY[...]`, the array-overlap operator); optional queue filter (`$3 = ANY(queues)`); ordered by name, max 500.

Used by [assign-modal.tsx#L28](../../apps/web/src/features/ticket/assign-modal.tsx#L28) and the queue-members card ([routing-section.tsx#L28](../../apps/web/src/features/admin/sections/routing-section.tsx#L28)). **It is not a validation step for the backend** (see the [manual assignment gap](../assignment-and-routing/manual-assignment.md#3-the-known-gap-the-assignee-is-not-validated)).

## 6. `PersonName`: batching in the browser

[person-name.tsx](../../apps/web/src/components/person-name.tsx):

```ts
let waiting = new Map<string, Waiter[]>(); let flushScheduled = false;
function requestName(user, subject) {                       // L25-L30
  return new Promise((resolve) => {
    waiting.set(subject, [...(waiting.get(subject) ?? []), resolve]);
    if (!flushScheduled) { flushScheduled = true; setTimeout(() => void flush(user), 10); }  // collect for 10 ms
  });
}
async function flush(user) {                                // L32-L42
  const batch = waiting; waiting = new Map(); flushScheduled = false;
  for (chunks of 200) { names = await lookupNames(user, chunk) /* on error: {} */; resolve each waiter with name or null; }
}
export function usePersonName(id) {                         // L56-L66
  const machine = id ? machineLabel(id) : null;             // system:* → "Automatic (...)", customer:* → "Customer (portal)"
  const query = useQuery({ queryKey: ['person', id], queryFn: () => requestName(user, id!), enabled: Boolean(id) && !machine, staleTime: 600_000 });
}
```

| Technique | Plain meaning |
|---|---|
| **Request batching** | A table of 50 rows asks for 50 names; they're collected for 10 ms and sent as **one** request (a "DataLoader" pattern) |
| Chunks of 200 | Matches the API limit |
| TanStack Query per ID, 10-minute stale time | The same person is never looked up twice |
| Machine labels without a request | `system:sla-timer` → "Automatic (sla-timer)" |
| Failure → show a shortened ID | "Names are a nicety: on failure the ID is shown instead" ([L39](../../apps/web/src/components/person-name.tsx#L39)) |
| Tooltip shows the full ID | Auditors sometimes need the exact ID; an unknown person's tooltip explains "has not opened the console yet" |

## 7. Interview answer

> I separate identity from display: records store immutable subject IDs, and a scoped directory maps them to names, refreshed best-effort from each person's own token at `/me`. Lookups are POSTs (so IDs stay out of URLs), limited to the caller's entity and country, and batched in the browser into one request per render with per-ID caching. Pickers use a permission- and queue-filtered endpoint. Authorization never reads names.
