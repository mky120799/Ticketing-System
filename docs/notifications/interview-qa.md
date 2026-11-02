# Notifications interview Q&A

[Back to Notifications index](README.md) · Study first: [How it works](how-it-works.md), [Data model and SQL](data-model-and-sql.md), [Live push](live-push.md)

Notifications look like a small feature, which makes them a favourite interview topic: they touch data modelling, transactions, security, real-time delivery, the frontend cache and scaling all at once. Answers are written to be said aloud.

---

## 30 seconds

> Notification rows are written in the same transaction as their cause, targeting either a person or a role in a queue within a legal entity and country, and a CHECK constraint guarantees an audience. The inbox evaluates that audience against the current user's token claims at read time, with read state stored per person. Creation fires a content-free `pg_notify` that every API instance turns into an empty SSE event for matching users, and the browser refetches. Notifications carry only a fixed title and a ticket ID, and opening one re-runs the ticket policy, so a notification is never an access grant.

## 2 minutes (structure)

1. **Durable inbox plus push hint**: why both.
2. **Fan-out on read**: one row for a whole queue audience, matched at read time, per-person read table.
3. **Atomicity**: same client, same transaction; NOTIFY only on commit.
4. **Security**: no content, audience filter in every query including mark-read, policy on open, `ticket:read` required.
5. **Live path**: LISTEN per instance, in-memory match, empty SSE frame, invalidation, resync.
6. **Limits and next steps**: read rows grow per reader, no index by user (measured 26 ms → 4 ms), no retention, no preferences.

---

## Design

**Q1. Why store notifications at all instead of just pushing over SSE?**
> A push is lost if the browser is closed, asleep or reconnecting. Rows give a durable inbox, an unread count and history. The push is only the "refresh now" accelerator; the table is the truth.

**Q2. How do you notify "all supervisors of payments" without a row per person?**
> One row with `recipient_queue = 'payments'`, `audience_role = 'supervisor'` and the legal entity and country. Each user's inbox query matches it against their own queues and roles. That is fan-out on read. Read state lives in a separate per-person table.

**Q3. Fan-out on write vs fan-out on read: when would you choose each?**
> On write: one row per recipient, trivial reads, but write cost grows with audience size and the recipient list is frozen. On read: one row, constant writes, membership evaluated live, but reads are more complex and per-person state needs its own table. For queue audiences where membership changes, on read fits. For a social feed with millions of followers you would mix them.

**Q4. Why evaluate the audience at read time?**
> Membership changes. If someone leaves the payments queue, the next request stops showing its notifications, with no rows to clean up and no window where a former member sees new ones.

**Q5. Why is read state a separate table?**
> One queue notification has many readers, each needing their own read flag. The composite primary key `(notification_id, user_id)` is the rule "a person reads a notification once".

**Q6. Why scope queue audiences by legal entity and country?**
> Queue names are not unique across a bank's entities. Without scope, a "payments" supervisor in Australia would see Indian payments notifications.

**Q7. What does the CHECK constraint add if the service already checks?**
> It holds for every write path, forever: a future worker, a backfill, a manual fix. `recipient_user IS NOT NULL OR (recipient_queue IS NOT NULL AND audience_role IS NOT NULL)` makes an orphan notification impossible.

---

## Transactions and correctness

**Q8. Why create the notification inside the business transaction?**
> So "assigned" and "you were notified" are atomic. If the assignment rolls back, the notification row and its push vanish with it. That is why `create` takes the caller's `PoolClient`.

**Q9. What happens if the NOTIFY is sent but the transaction rolls back?**
> It is never delivered. PostgreSQL holds NOTIFY messages until commit and discards them on rollback; I demonstrated it in a lab with one rolled-back and one committed message.

**Q10. The SLA job runs every minute. Why don't breached tickets notify every minute?**
> The reconciler only updates tickets whose status actually changes (`IS DISTINCT FROM`), and notifications are created for the rows that update returns. So one notification per transition.

**Q11. The list and the unread count are two queries. Can they disagree?**
> Yes, briefly: each autocommit statement has its own snapshot, so a notification committed between them can be in one and not the other. The next refetch corrects it. If it mattered, run both in one REPEATABLE READ read-only transaction.

**Q12. Is "mark read" safe against double clicks and races?**
> Yes. It skips already-read rows and uses `ON CONFLICT DO NOTHING`, so two simultaneous requests insert one marker.

---

## Security

**Q13. Can a notification leak data?**
> It holds a fixed title such as "A ticket was assigned to you" and a ticket ID: no customer name, no account, no message text. The push frame is literally `{}`. Opening it calls the protected ticket API, which can return "not available" if access changed.

**Q14. Could someone mark another user's notifications read?**
> No. `markRead` is an `INSERT ... SELECT` that includes the caller's audience filter, and the marker carries the caller's subject from the token. Sending someone else's notification ID inserts nothing; I showed `INSERT 0 0` in a lab.

**Q15. Where do the audience values come from?**
> The verified token's `UserContext`: subject, queues, roles, legal entity and country. Never from the request body.

**Q16. Who can use the inbox?**
> Anyone with `ticket:read`. Administrators configure the system but have no case access, so they get no bell and no live stream, on both the server and the client.

**Q17. Could the SSE stream outlive a revoked session?**
> Not past the token's expiry: the server closes the stream with an `expired` event at that moment, and the browser reconnects with its renewed token or signs out on 401.

---

## Live delivery

**Q18. How does a notification reach the browser in real time?**
> `pg_notify('ticket_live', {kind: person, user | queue+role, scope})` inside the transaction. Every API instance has one LISTEN connection; on commit each receives the message, matches it against its own connected users in memory, and writes `event: notification` / `data: {}` to their SSE streams. The browser invalidates its notifications query and refetches.

**Q19. Why doesn't the push carry the notification itself?**
> Minimisation and simplicity. An empty hint cannot leak anything, and refetching through the normal API re-applies authorisation and returns exactly what the server considers current.

**Q20. How does it work with several API instances without Redis or Kafka?**
> PostgreSQL's NOTIFY is broadcast to every listening session, so every instance hears every message and serves its own subscribers.

**Q21. What if the LISTEN connection drops?**
> Messages sent meanwhile are lost. The listener reconnects with exponential backoff, and after reconnecting broadcasts `resync`, which makes every browser refetch everything. Nothing is really lost because the inbox is a table.

**Q22. Why SSE and not WebSockets? Why not `EventSource`?**
> One-way hints are all we need, and SSE is plain HTTP. `EventSource` cannot send an Authorization header, so the client reads the stream with `fetch` and a stream reader, with its own backoff.

**Q23. Any subtle NOTIFY behaviour?**
> Identical payloads in one transaction are delivered once. For refresh hints that is a feature: twenty notifications for one supervisor in an SLA batch cause one refetch.

**Q24. The audience rule exists in SQL and in TypeScript. Is that a problem?**
> It is duplication that must stay in sync. Drift cannot leak data, because the frame is empty and the SQL is authoritative, but it could cause missed or wasted refetches. I would add a shared test that runs both rules against the same cases.

---

## Frontend

**Q25. Does the bell poll?**
> No. It refetches on mount, on a live `notification` event, on resync, and after marking read. If the stream is down the header shows "Offline", and the reconnect's resync catches up.

**Q26. Why invalidate instead of updating the cache optimistically after mark-read?**
> The badge then always shows the server's count. Optimistic edits feel faster but can disagree with the server, for example if a new notification arrived meanwhile.

---

## Scaling and limits

**Q27. What breaks first at scale?**
> Read state. "Mark all read" writes one row per notification, so `notification_reads` outgrows `notifications` (44 MB vs 6 MB in my lab). With no index by user, the inbox and unread count scan it: I measured 5 ms growing to about 30 ms at 343,000 rows, and back to about 4 ms with an index on `(user_id, notification_id)`.

**Q28. Did you try other fixes?**
> A `UNION ALL` of the two audience branches, each ordered and limited to 50, brought the inbox to 2 to 6 ms without a new index, because it does 50 primary-key lookups instead of scanning read state. Capping the unread count at 100 did nothing (14.3 vs 14.2 ms), because the cost is building the join, not counting. Measuring first avoided shipping that.

**Q29. What about retention?**
> Nothing deletes notifications today. A notification's value is short-lived, so a 90-day batched delete (read markers cascade), or monthly partitions you drop, after checking the bank's record-keeping policy.

**Q30. How would you redesign "mark all read"?**
> A per-user watermark: "everything created before T is read", plus per-row markers only for individual reads. Mark-all becomes one upsert; unread means created after the watermark and not individually read.

---

## Follow-up traps

| Trap | Good answer |
|---|---|
| "So SSE guarantees delivery?" | No, it is best effort. The table is the guarantee; SSE only makes it fast |
| "You trust the client's list of IDs in mark-read?" | Only as a filter. The audience predicate inside the insert decides what can be marked |
| "A notification proves the user may open the ticket?" | No. It is a pointer; the ticket endpoint re-checks policy every time |
| "Why not a `read` column on notifications?" | One queue notification has many readers |
| "Why not fan out per supervisor to keep reads simple?" | Then leaving a queue would not remove notifications, and audiences would be frozen at write time |

---

## Honest limitations to volunteer

- No index on `notification_reads (user_id, ...)`; measured fix.
- No retention for notifications or read markers.
- "Mark all read" writes one row per notification.
- The "contact the customer directly" notification reuses the `approval_needed` type.
- `type` is not CHECK-constrained in the database.
- The audience rule is implemented twice (SQL and TypeScript).
- Only the newest 50 are reachable in the UI; no preferences; no email or Teams fan-out; no browser test for the bell.
