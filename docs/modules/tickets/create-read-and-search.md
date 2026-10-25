# Tickets: creation, reads and search

This guide follows `POST /tickets`, paged listing, metadata search and full ticket projection through [`TicketsController`](../../../apps/api/src/tickets/tickets.controller.ts) and [`TicketsService`](../../../apps/api/src/tickets/tickets.service.ts).

## DTO and HTTP boundary

The global `ValidationPipe` transforms input, strips nothing silently (`forbidNonWhitelisted: true`) and applies [`CreateTicketDto`](../../../apps/api/src/tickets/ticket.dto.ts): controlled priority/sensitivity enums, bounded scope strings, subject up to 200, description up to 10,000, a JSON object and at most ten typed references.

The controller additionally requires an `Idempotency-Key` header of at most 128 characters. Unlike most ticket-id routes, `ticketId` itself currently has no `ParseUUIDPipe`; malformed UUID handling should be improved to a stable `400` instead of depending on the PostgreSQL cast error path.

## Creation transaction

Before opening the transaction, `create` asserts `ticket:create` and exact equality between caller scope and DTO branch/department/entity/country, plus queue membership. This prevents a caller from selecting another region even if the queue/category exists globally.

Inside one `PgService.transaction`:

1. SHA-256 hash the serialized DTO.
2. `SELECT ... FOR UPDATE` the `(actor_id, idempotency_key)` record.
3. Existing same hash: return the original ticket projection. Existing different hash: `409`.
4. Generate the ticket UUID.
5. `CaseConfigurationService.assertTicketSelection` checks active category/queue/department relationships.
6. `SlaService.calculate` selects the default policy for priority and computes deadlines.
7. Insert `tickets`, then SLA fields and masked `ticket_references`.
8. Insert the idempotency record.
9. Write `ticket.created` audit evidence and enqueue the outbox event.
10. Apply compliance-at-creation rules.
11. Run automatic assignment under the same transaction.
12. Queue a PostgreSQL live notification and return the aggregate projection.

If any insert/provider throws, all database changes—including audit, outbox, auto-assignment and `pg_notify`—roll back. File/email/Kafka network work is not performed here.

### Idempotency race analysis

The primary key on `(actor_id, idempotency_key)` is the final uniqueness boundary. The initial `SELECT ... FOR UPDATE` cannot lock a row that does not exist, so two truly concurrent first uses can both proceed until one insert wins and the other receives a uniqueness error. The current service does not catch that unique violation and reload the winner. It prevents duplicate committed tickets because the transaction losing the idempotency insert rolls back, but the losing request may receive a server/database conflict rather than the original response. A hardened implementation would use an insert-first reservation or catch the unique violation, roll back and replay through a new transaction.

## Paged list

`GET /tickets?limit=&cursor=` requires `ticket:read`. Limit is clamped to 1–100. The opaque base64url cursor encodes `(created_at|uuid)` and is validated before use. SQL filters entity, country and queues, uses tuple keyset pagination and requests `pageSize + 1` rows:

```sql
WHERE legal_entity = $1
  AND country = $2
  AND queue = ANY($3::text[])
  AND ($4 IS NULL OR (created_at, id) < ($4, $5))
ORDER BY created_at DESC, id DESC
LIMIT $6
```

The service then applies `PolicyService.assertTicketAccess` in memory for branch/ownership and restricted sensitivity. Only visible rows are serialized. Because the cursor advances using the raw scoped page rather than only visible rows, inaccessible rows are skipped without stalling pagination, although a page may contain fewer visible items than requested.

`X-Next-Cursor` is set by the controller and exposed through CORS. Each list request writes one bounded `ticket.list_viewed` event unless `AUDIT_LIST_VIEWS=false`.

## Search

`GET /tickets/search?q=&limit=` validates a 1–80 character term and 1–50 limit. `%`, `_` and the escape character are escaped before an `ILIKE` query across subject, category, status and queue. SQL applies entity/country/queue before the in-memory ticket policy filter.

Search returns only list fields—not descriptions, notes, full references or communication recipients. It is audited as one search event with result count, up to 50 opaque ids and a boolean indicating a term existed; the term itself is deliberately not copied into audit metadata.

## Full detail projection

`GET /tickets/:ticketId` runs `getInTransaction`. It loads the ticket, checks `ticket:read`, then queries references, notes, attachments, relationships, communications/approvals, status history and retention controls. Full references remain masked. It also calls `WorkflowDefinitionService.nextStatuses` using the same transaction client.

The response is assembled explicitly rather than serializing database rows blindly. A direct view writes `ticket.viewed`; internal creation replay can request the projection without a second view audit event.

One detail read performs several sequential SQL queries. This is easy to reason about and consistent inside one transaction, but a high-volume version may combine/batch reads or use a dedicated projection while avoiding join multiplication.

## Frontend path

[`create-ticket-modal.tsx`](../../../apps/web/src/features/tickets/create-ticket-modal.tsx) obtains categories/queues, creates one browser UUID idempotency key and submits through `api.ts`. [`useTicketList`](../../../apps/web/src/features/tickets/use-ticket-queries.ts) chooses infinite cursor paging or a one-page search query. URL search/filter state lives in [`tickets-page.tsx`](../../../apps/web/src/features/tickets/tickets-page.tsx).

Local quick views/filtering operate only on already authorized loaded rows. Server search returns safe fields, so search mode disables views that depend on absent assignee/SLA data.

## Tests and interview answer

Test exact retry, conflicting retry, concurrent first use, invalid config/scope, transaction rollback, cursor tampering, page bounds, branch/restricted filtering, escaped search wildcards and detail projection masking.

> Ticket creation first checks the actor's claimed scope, then transactionally reserves idempotency, validates configured queue/category, calculates SLA, inserts the aggregate/references, appends audit and outbox, applies compliance and auto-assignment, and emits a commit-time live hint. Lists use keyset pagination with entity/country/queue SQL predicates plus the full resource policy; search returns a reduced projection. I would harden concurrent first-use idempotency by catching the unique-key race and replaying the winning record.
