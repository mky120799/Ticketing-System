# Tickets interview Q&A

[Back to Tickets index](README.md) · Technique: [answer playbook](../interview-prep/answer-playbook.md)

---

## 1. The three levels

### 30 seconds
> Tickets are a transactional aggregate. The controller validates a DTO and passes the verified user and correlation ID to `TicketsService`. Each use case runs in one PostgreSQL transaction: load the ticket, check policy, apply domain rules, write, then append audit, enqueue an outbox event and issue `pg_notify` on the same client. Creation is idempotent via a persisted key-plus-hash record, lists use keyset pagination, and the UI refetches one ticket after each change.

### 2 minutes
> `POST /tickets` requires an `Idempotency-Key`. The service checks that the requested branch, department, entity, country and queue match the creator's own scope, hashes the body, and in one transaction looks up the key. Same hash returns the original; a different hash is a 409. Otherwise it re-validates the category/queue configuration, calculates SLA deadlines with the business calendar, inserts the ticket and masked references, records the key, writes audit and outbox, applies compliance rules, auto-assigns under a per-queue advisory lock and queues a live notification. All of that commits or none of it does.
>
> Mutations follow one skeleton with action-specific permissions: update, assign, reveal, approve, hold. Edits send `expectedUpdatedAt` and get a 409 `stale_ticket` if outdated. Status changes go through a data-driven workflow, require a root cause and, for complaints, an outcome, pause or resume the SLA, and can queue the resolution notice in the same commit.
>
> Lists filter entity, country and queues in SQL with `(created_at,id)` keyset pagination, then apply the full policy per row. The React side uses an infinite query and a shared mutation hook that refetches and patches caches.

### Code-level
```text
tickets.controller.ts        create L43-53 (Idempotency-Key), list L54-68 (X-Next-Cursor)
tickets.service.ts           create L31-60, list L69-85, search L87-97, transition L168-196,
                             getInTransaction L351-363, assertFresh L369-371, changeSummary L372-379
ticket.dto.ts                CreateTicketDto, TransitionTicketDto, enums
features/tickets/use-ticket-queries.ts   useTicketList, useTicketMutation
features/tickets/ticket-cache.ts         refreshTicket, patchTicketInLists
```

---

## 2. Questions and model answers

**Q1. How do you stop a double-click creating two tickets?**
> The browser sends a UUID `Idempotency-Key`. The service stores `(actor, key, sha256(body), ticketId)` in the same transaction as the ticket. A retry with the same key and body returns the original; same key, different body is a 409. Because it's persisted, it works across replicas and restarts.

**Q2. Is that idempotency race-free?**
> Not perfectly. `FOR UPDATE` can't lock a row that doesn't exist, so two simultaneous first uses can both proceed. The primary key stops a duplicate commit (the loser rolls back), but the loser gets an error instead of the original ticket. I'd catch the unique violation and replay, or insert the key first as a reservation.

**Q3. Why check the creator's scope against the DTO?**
> So nobody can file a ticket into another branch, entity or country, even if that queue exists. The scope must equal the token's scope exactly, and the queue must be one of theirs.

**Q4. Why re-validate category and queue at create time when the UI already listed them?**
> Configuration can change after the UI loaded. `assertTicketSelection` checks the combination is active and compatible *now*. Never trust a previously cached option list.

**Q5. Why keyset pagination instead of OFFSET?**
> OFFSET reads and discards rows, so page 1,000 is slow, and new tickets shift items between pages. Keyset uses the index and is stable. I include `id` as a tie-breaker because timestamps can collide, and I fetch `limit+1` to know if there's a next page without a count.

**Q6. Why is the cursor opaque?**
> So clients don't construct it. It's base64url of `createdAt|id`, validated on the way in. A malformed cursor is a 400, not a SQL error.

**Q7. Lists filter some policy in memory. Isn't that a leak risk?**
> No: rows are filtered before serialisation, so nothing unauthorised is returned. The cost is efficiency (short pages). The improvement is to express branch, ownership and sensitivity in SQL.

**Q8. What does search cover, and why so little?**
> Subject, category, status and queue only, with escaped `ILIKE`. Description, notes and references aren't searchable, which keeps the search from becoming a content-leak channel. Results are a reduced projection, and the audit stores a "had term" boolean, not the term.

**Q9. How does optimistic concurrency work, and is it correct?**
> Clients send the `updatedAt` they saw; a mismatch is a 409 `stale_ticket`, and the UI refetches. It catches already-stale browsers, but not two simultaneous writes, because the read isn't `FOR UPDATE` and the `UPDATE` doesn't include `WHERE updated_at = $expected`. Fix: a conditional update with a zero-row 409, or a row lock, proven by a two-connection test.

**Q10. How do you audit an edit without storing personal data?**
> `changeSummary` stores old and new priority directly, but for the description only the "changed" flag, both lengths and both SHA-256 fingerprints, and for custom fields only the changed key names. The immutable trail proves the change without holding the text.

**Q11. How are references protected?**
> They're opaque source-system IDs, stored with a masked value. Only supervisors can reveal, with step-up; the reveal is audited with a count, and the UI shows the values once and doesn't cache them.

**Q12. What happens when a ticket is resolved?**
> The workflow edge is checked, a root cause (and outcome for regulated cases) is required, the SLA resumes if it was paused, the resolved time and root cause are stamped, audit and outbox are written, and the resolution notice to the customer is queued, or a reason is audited, all in one commit.

**Q13. How does the UI stay consistent?**
> One mutation hook: on success or 409 it refetches the ticket through the API and patches it into the detail cache and every list; 403/404 removes it. SSE events from colleagues call the same refresh.

**Q14. Why does the case page show 403 and 404 the same?**
> To avoid confirming that a hidden ticket exists.

---

## 3. Honest limitations

1. Non-atomic optimistic check → conditional update.
2. Idempotency first-use race returns an error → catch and replay.
3. Manual assignee not validated → check queue membership.
4. Most `:ticketId` routes lack `ParseUUIDPipe` → 400 instead of a DB error.
5. List policy partly in memory → push into SQL.
6. Detail view is 8 sequential queries → fine now; batch at scale.

## 4. If you blank

> "The invariant is one transaction per use case: load, policy, rules, write, then audit and outbox on the same client, so there's no change without evidence and no event without a change. I'd open `tickets.service.ts` at `create` and `transition` to show it."
