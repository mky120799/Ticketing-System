# Ticket concepts and glossary

[Back to Tickets index](README.md)

---

### Aggregate / aggregate root (Domain-Driven Design)
**Technical:** A consistency boundary: a root entity plus child entities that must change together and are only modified through the root.
**Plain:** The ticket is the folder. Notes, status history and attachments are pages in the folder. Nobody edits a page directly; they ask the folder's clerk (`TicketsService`), who keeps every page consistent.
**In our code:** `TicketsService` is the only writer of `tickets` and its child tables for staff actions ([tickets.service.ts](../../apps/api/src/tickets/tickets.service.ts)).

### Orchestrator service
**Plain:** `TicketsService` doesn't calculate SLAs or pick assignees itself. It *coordinates* specialists (SLA, assignment, compliance, workflow, notifications) and passes them its transaction client, so all their writes are part of the same commit ([constructor, L29](../../apps/api/src/tickets/tickets.service.ts#L29)).

### DTO (Data Transfer Object) + ValidationPipe
**Technical:** A class whose decorators (`@IsIn`, `@Length`...) describe valid input. Nest's global `ValidationPipe` validates and transforms the JSON body into that class before the controller runs.
**Plain:** A bouncer with a checklist. Anything not on the list (`forbidNonWhitelisted`) or out of range is turned away with 400 before business code sees it.
**In our code:** [ticket.dto.ts](../../apps/api/src/tickets/ticket.dto.ts); pipe options at [main.ts#L23](../../apps/api/src/main.ts#L23).

### Idempotency key
**Technical:** A client-generated unique key sent with a non-idempotent request (POST). The server stores the key and the result; a retry with the same key returns the stored result instead of acting twice.
**Plain:** A cloakroom ticket. If you hand the same ticket twice, you get the same coat back, not two coats.
**Why:** double-clicks, browser retries and network timeouts must not create two tickets.
**In our code:** header `Idempotency-Key` ([tickets.controller.ts#L45-L51](../../apps/api/src/tickets/tickets.controller.ts#L45-L51)); table `idempotency_records`; browser generates a UUID per create ([api.ts#L125](../../apps/web/src/api.ts#L125)).

### Request hash (fingerprint)
**Plain:** We store the SHA-256 of the request body with the key. Same key + same body → return the original. Same key + **different** body → 409 Conflict, because the key was reused for something else (a client bug or an attack) ([tickets.service.ts#L36-L42](../../apps/api/src/tickets/tickets.service.ts#L36-L42)).

### Keyset (cursor) pagination
**Technical:** Fetch the next page with `WHERE (created_at, id) < (:lastCreatedAt, :lastId) ORDER BY created_at DESC, id DESC LIMIT n`, instead of `OFFSET`.
**Plain:** "Give me the next 50 older than the last one I saw." It stays fast on page 1,000, and new tickets arriving don't shift items between pages.
**Why `(created_at, id)`:** two tickets can share a timestamp; adding the unique `id` makes the order total.
**In our code:** [tickets.service.ts#L69-L85](../../apps/api/src/tickets/tickets.service.ts#L69-L85); index `tickets_paging_idx` ([migration …25000](../../apps/api/migrations/1710000025000_paging_and_reporting.cjs#L4)).

### Opaque cursor (base64url)
**Plain:** The cursor `MjAyNi0xMC0yNVQxMDowMDowMC4wMDBafDRmMWM...` is just `createdAt|id` encoded, so clients treat it as a token, not something to construct. It is validated on the way back in (date parses, id is a UUID), else 400 ([L73-L77](../../apps/api/src/tickets/tickets.service.ts#L73-L77)).

### Opaque reference and masking
**Technical:** An opaque reference is an identifier from a source system (CRM customer ID) that is meaningless outside it, never a raw account or card number. Masking shows only the last 4 characters.
**Plain:** The ticket stores "customer CRM-77812345" and shows `••••••••2345`. Seeing the full value is a separate, step-up, audited "reveal".
**In our code:** `mask()` ([L383](../../apps/api/src/tickets/tickets.service.ts#L383)); `masked_value` column; `revealReferences` ([L144-L152](../../apps/api/src/tickets/tickets.service.ts#L144-L152)).

### Sensitivity (standard / confidential / restricted)
**Plain:** How secret the case is. `restricted` (e.g. staff misconduct, VIP fraud) is visible only to supervisors and auditors ([policy.service.ts#L30](../../apps/api/src/auth/policy.service.ts#L30)).

### Optimistic concurrency (optimistic locking)
**Technical:** Don't lock while the user edits; on save, send the version you saw (`expectedUpdatedAt`). If the current version differs, refuse with 409.
**Plain:** "I edited version 3." If someone else already saved version 4, your save is rejected so you don't silently overwrite their work.
**In our code:** `assertFresh` ([L369-L371](../../apps/api/src/tickets/tickets.service.ts#L369-L371)) returns `409 { code: 'stale_ticket' }`. **Caveat:** the check is not atomic. See [mutations-and-concurrency.md](mutations-and-concurrency.md#3-the-concurrency-gap-be-honest-about-this).

### Pessimistic lock (`SELECT ... FOR UPDATE`)
**Plain:** "Reserve this row until my transaction ends; others wait." Used for approvals, attachments, escalations and customer replies. Not yet used for the general ticket read.

### Projection
**Plain:** The shape we send to a client, built field by field. `publicTicket` renames columns to camelCase and drops internals ([L381](../../apps/api/src/tickets/tickets.service.ts#L381)); `getInTransaction` assembles the full case view ([L351-L363](../../apps/api/src/tickets/tickets.service.ts#L351-L363)). We never blindly serialise rows.

### Status history
**Plain:** An append-only log of every status move with reason and actor (`ticket_status_history`). The Activity tab merges it with notes into one timeline.

### Root cause and IDR outcome
**Plain:** When resolving, you must say *why* it happened (`process_gap`, `system_error`, ..., [ticket.dto.ts#L42](../../apps/api/src/tickets/ticket.dto.ts#L42)), and for complaints, *what the bank decided* (Internal Dispute Resolution outcome: `upheld`, `not_upheld`...). These feed the dashboard and the complaints register.

### Custom fields (`jsonb`)
**Plain:** A bank-specific key/value bag (`{ "productCode": "VISA-GOLD" }`) without schema changes. Edits are audited by changed key names only.

### Correlation ID
**Plain:** The click's trace ID. Every service method takes `correlationId` and puts it on audit and outbox rows.

### Search escaping (`ILIKE ... ESCAPE '\'`)
**Plain:** `%` and `_` are wildcards in SQL `LIKE`. We escape them so searching `50%` doesn't match everything ([L89](../../apps/api/src/tickets/tickets.service.ts#L89)).

### 403 vs 404 for hidden tickets
**Plain:** The case screen shows "This ticket is not available" for both, so a user can't probe whether a ticket ID exists outside their scope ([ticket-page.tsx#L44-L49](../../apps/web/src/features/ticket/ticket-page.tsx#L44-L49)).
