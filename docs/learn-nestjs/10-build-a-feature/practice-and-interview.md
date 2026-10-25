# Lesson 10 tests, delivery and interview drill

[Core chapter](README.md) · [Backend lab](backend-code-lab.md) · [Frontend lab](frontend-code-lab.md) · **Tests and interview** · [Course index](../README.md)

## 1. Test matrix

| Test | Level | Guarantee |
|---|---|---|
| rating 0, 6, decimal, extra field rejected | HTTP E2E with production validation setup | DTO boundary |
| missing/malformed bearer rejected | E2E | guard is attached |
| outside queue/restricted ticket denied | policy/service unit | resource policy |
| unresolved ticket returns coded 409 | service + integration/E2E | current state rule |
| valid request creates rating, audit and outbox | PostgreSQL integration | successful transaction |
| forced audit failure leaves no rating/outbox | PostgreSQL integration | atomic rollback |
| two same-actor requests create one row | synchronized PostgreSQL integration | unique race guarantee |
| different actors can both rate | integration | intended unique scope |
| panel hidden/disabled for ineligible state | frontend component | presentation behavior |
| success refetches and clears form | frontend component/hook | cache/form behavior |
| 409 preserves input and refetches | frontend component/hook | conflict recovery |
| comment rendered as escaped text | frontend component | XSS-safe rendering |

## 2. Integration-test skeleton

The exact setup should reuse the repository's disposable database/migration helpers. Core assertion shape:

```ts
it('commits rating, audit and outbox together', async () => {
  const result = await ratings.create(
    caseAgent,
    resolvedTicketId,
    { rating: 5, comment: 'Helpful' },
    'correlation-1',
  );

  expect(result.rating).toBe(5);
  expect(await count('ticket_ratings', resolvedTicketId)).toBe(1);
  expect(await countAudit('ticket.rating_created', resolvedTicketId)).toBe(1);
  expect(await countOutbox('ticket.rating_created', resolvedTicketId)).toBe(1);
});
```

For rollback, create a controlled database/provider failure inside `audit.write` while preserving use of the real transaction, then assert all three counts are zero. Merely mocking `audit.write` and seeing the service reject does not prove PostgreSQL rollback unless the business write is real and uses the same client.

## 3. Concurrency-test shape

Use two independent requests/connections released from a barrier:

```text
arrange one resolved ticket and actor
-> pause both operations immediately before insert
-> release together
-> await both
-> one succeeds
-> one receives rating_already_exists 409
-> exactly one rating row
-> exactly one success audit
-> exactly one rating outbox event
```

The unique constraint, not timing luck, decides the winner.

## 4. Frontend-test cases

With a test QueryClient and mocked API boundary:

1. unresolved ticket shows explanation and no enabled submit;
2. resolved ticket accepts 1–5 and optional text;
3. click while pending cannot send twice;
4. success notification contains rating and form resets;
5. 409 leaves comment intact and invokes ticket refresh;
6. 403 shows safe refusal and does not retry;
7. a comment like `<img onerror=...>` appears as text, never executable HTML;
8. labels are discoverable by role/name and submission works by keyboard.

## 5. Delivery checklist

Before merging:

- run API build/lint/unit/E2E/integration suites;
- run staff frontend type-check/build/lint/tests;
- apply migration to a disposable database and inspect schema/constraint names;
- verify a rolling deployment where old frontend/API versions coexist;
- add route/event/access documentation;
- add metrics for create success/refusal/conflict without rating comments as labels/logs;
- verify audit metadata contains no comment;
- confirm backup/restore and retention classification for the new table;
- define rollback: hide UI first, stop writes, then remove schema only in a later migration if safe.

## 6. Full interview answer

> I implemented ratings as a vertical feature rather than only adding a controller. I first defined `POST /v1/tickets/:ticketId/ratings` and stable 400/401/403/404/409 behavior. A class DTO bounds the integer to 1–5 and optional comment to 500 characters; the global pipe rejects unknown fields. `AuthGuard` supplies the actor, and `RatingsService` loads and locks the ticket, runs `PolicyService` for `ticket:update`, and requires current status `resolved`. PostgreSQL has a unique `(ticket_id, actor_id)` constraint, so concurrent duplicate requests cannot both commit; I map that named constraint to `rating_already_exists` 409.
>
> The insert, minimized audit event and outbox event all use the same transaction client, so audit failure rolls back the rating. The response is explicitly mapped rather than exposing raw rows. In React, I added a typed API function through the shared bearer/correlation/error client and a ticket mutation that refetches authoritative state after success or conflict. The panel is shown only for a resolved, presentation-capable user, but the API repeats all security/state checks. The form disables while pending, preserves text on error and renders comments as escaped text.
>
> Unit tests prove policy branches, E2E tests prove guard/DTO/status behavior, PostgreSQL tests prove uniqueness and atomic rollback under concurrency, and frontend tests prove cache/error/accessibility behavior. One design choice I would confirm with product is whether ratings are staff-only; customer ratings belong behind the separate portal identity and ownership boundary.

## 7. Whiteboard version

```text
RatingPanel
  -> createTicketRating(shared API client + bearer + correlation)
  -> POST /v1/tickets/:id/ratings
  -> AuthGuard -> UserContext
  -> ValidationPipe -> CreateRatingDto
  -> RatingsController.create
  -> RatingsService.create
       -> SELECT ticket FOR UPDATE
       -> PolicyService.assertTicketAccess
       -> require resolved
       -> INSERT rating (DB unique)
       -> AuditService.write(same client)
       -> OutboxService.enqueue(same client)
  -> commit -> mapped response
  -> React Query refreshTicket -> render authoritative rating
```

## 8. Questions that expose implementation depth

1. **Why lock the ticket?** To evaluate mutable resolved state consistently with concurrent ticket updates during this transaction.
2. **Why still need a unique constraint?** A lock on the ticket serializes callers if consistently taken, but the database constraint is the durable invariant and protects every write path.
3. **Why catch a named constraint?** Code `23505` could come from another unique rule; mapping only the intended constraint avoids misleading conflicts.
4. **Why not audit the comment?** Immutable evidence should minimize free text/sensitive duplication; `rating` and `hasComment` prove the action.
5. **Why no optimistic frontend row?** Authorization, state and uniqueness can reject; authoritative refetch is simpler and safe for a low-frequency action.
6. **Why does UI capability not count as security?** Browser code is caller-controlled and may be stale; API policy is authoritative.
7. **What happens if outbox enqueue fails?** The transaction rolls back rating and audit; the caller gets failure and can retry deliberately.
8. **What happens if publish later duplicates?** Consumers deduplicate using outbox event id; publication is at least once.

## 9. Completion rubric

| Level | Evidence |
|---|---|
| Framework-level | can write controller, DTO and module |
| Application-level | can implement policy and transaction |
| Production-level | can prove concurrency, atomic evidence and failure recovery |
| Full-stack | can integrate typed API, cache, UX and accessibility |
| Interview-ready | can narrate exact code path, tests, trade-offs and one known decision/limitation |

If you can reproduce the whiteboard path and answer the eight questions without notes, the course objective is complete.
