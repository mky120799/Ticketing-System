# Performance and limits

[Back to Notifications index](README.md) · Previous: [Frontend](frontend.md) · Next: [Hands-on labs](hands-on-labs.md)

The notification feature is correct and secure today. This page asks the next question an experienced engineer, or interviewer, will ask: **what happens after two years of use?** Every number below was measured on a lab copy of our schema ([lab setup](../database/hands-on-labs.md#setup-a-scratch-copy-of-our-schema)) with 20,000 notifications, and then with 343,000 read markers, so the conclusions are evidence, not guesses. Plans are read with the method from [Database: indexes and query plans](../database/indexes-and-query-plans.md#4-reading-explain-analyze).

---

## 1. The inbox query plan

For a user who is both a person recipient (2,000 notifications) and a supervisor of `payments` (3,334 notifications):

```text
 Limit (actual rows=50 loops=1)
   Buffers: shared hit=371
   ->  Sort (actual rows=50 loops=1)
         Sort Key: n.created_at DESC
         Sort Method: top-N heapsort  Memory: 31kB
         ->  Hash Left Join (actual rows=5334 loops=1)
               ->  Bitmap Heap Scan on notifications n (actual rows=5334 loops=1)
                     ->  BitmapOr
                           ->  Bitmap Index Scan on notifications_recipient_user_created_at_index (actual rows=2000 loops=1)
                           ->  Bitmap Index Scan on notifications_recipient_queue_audience_role_created_at_index (actual rows=3334 loops=1)
               ->  Hash
                     ->  Seq Scan on notification_reads r (actual rows=0 loops=1)
                           Filter: ((user_id)::text = 'agent-2'::text)
 Execution Time: 5.038 ms
```

How to read it:

- **The two indexes work as designed.** A `BitmapOr` combines "addressed to me" and "addressed to my queue+role", one index per side of the `OR`.
- **But the inbox reads every matching notification.** A bitmap scan returns rows in physical order, not `created_at` order, so PostgreSQL fetches **all 5,334** matches and keeps the newest 50 with a top-N sort. The cost grows with the number of notifications a person has *ever* had, not with the 50 shown.
- **`notification_reads` is read by sequential scan.** Its only index is the primary key `(notification_id, user_id)`, which cannot find "all rows for user X" because `user_id` is the second column. With an empty table that costs nothing. It will not stay empty.

---

## 2. How read state grows

With fan-out on read ([concepts](concepts.md#2-targeting-and-fan-out)), one notification for a queue audience has **one read marker per supervisor who reads it**. "Mark all read" writes a marker for every unread notification the user can see, in one statement. Measured for one supervisor of a busy queue:

```text
INSERT 0 3334        ← one click of "Mark all read"
```

So the size of `notification_reads` is roughly **(notifications sent to queue audiences) × (supervisors who mark all read) + (person notifications read)**. In the lab, 100 users marking a queue's notifications read produced **343,402 rows (44 MB)**, seven times the size of the `notifications` table itself (5.9 MB). It is normal for the read-state table in a fan-out-on-read design to become the biggest table in the feature.

---

## 3. What that growth does to the queries

Re-running the same queries with 343,000 read markers:

| Query | Before (empty reads) | After (343k reads) | Why it slowed |
|---|---|---|---|
| Inbox (`inbox()`) | 5.0 ms | **26 to 37 ms** | the hash join builds from a `Parallel Seq Scan` over all read markers to find this user's 5,334 |
| Unread count (`unreadCount()`) | 2.2 ms | **14 to 16 ms** | same scan |

Both run on **every** inbox load, and every live `notification` event makes every matching online browser load the inbox. A queue-wide SLA breach notifying 30 supervisors causes 30 inbox loads at the same moment.

### Fix 1: an index on read state by user (measured)

```sql
CREATE INDEX notification_reads_user_idx ON notification_reads (user_id, notification_id);
```

| Query | Without | With the index |
|---|---|---|
| Unread count | 14.2 ms (Parallel Seq Scan, 169,033 rows removed per worker) | **3.7 ms** (Bitmap Index Scan on the new index) |
| Inbox | 26.3 ms | **4.0 ms** |

This is the **highest-value change** for the feature: one migration (build it `CONCURRENTLY` on a live system, see [Database: migrations](../database/migrations-and-roles.md#4-writing-a-safe-migration)) and no code change.

### Fix 2: an inbox query that uses index order (measured)

Splitting the `OR` into a `UNION ALL` of two ordered sub-queries, each limited to 50, lets PostgreSQL stop early on the person branch and then check read state for only 50 rows:

```sql
SELECT x.id, x.created_at, r.read_at FROM (
  (SELECT id, created_at FROM notifications WHERE recipient_user = $1 ORDER BY created_at DESC LIMIT 50)
  UNION ALL
  (SELECT id, created_at FROM notifications WHERE recipient_queue = ANY($4) AND audience_role = ANY($5)
     AND legal_entity = $2 AND country = $3 ORDER BY created_at DESC LIMIT 50)
) x
LEFT JOIN notification_reads r ON r.notification_id = x.id AND r.user_id = $1
ORDER BY x.created_at DESC LIMIT 50
```

Measured with 343k read markers and no new index: **2.0 to 5.8 ms**, against 26 to 37 ms for the current query. The plan becomes an `Index Scan Backward` on the person index plus **50 primary-key lookups** (`Index Scan using notification_reads_pk ... loops=50`) instead of a scan of the whole read table. (A row matching both branches would appear twice; `create` never writes such a row, but a `UNION` or a `DISTINCT ON (id)` would make that explicit.)

### What does not help: capping the count

Because the badge stops at "99+", it is tempting to count at most 100 (`SELECT count(*) FROM (... LIMIT 100)`). Measured: **14.3 ms vs 14.2 ms**, no gain. The cost is not the counting; it is building the hash join over the read table, which happens before the first row is produced. Measuring before optimising saves you from shipping changes like this.

---

## 4. Growth and retention

Nothing deletes notifications today ([data model, section 6](data-model-and-sql.md#6-deletion)). On the project's own local database after normal development: **17,397 notifications for 3,483 tickets**, about five per ticket. At a bank handling 2,000 cases a day that is roughly 3.6 million notifications a year, plus read markers.

A notification's value is short-lived: it says "look at this now". A retention job is the natural fix:

```sql
-- run daily, in batches, so each transaction is short and vacuum keeps up
DELETE FROM notifications
WHERE id IN (SELECT id FROM notifications WHERE created_at < now() - interval '90 days' LIMIT 5000);
-- notification_reads rows are removed automatically by ON DELETE CASCADE
```

Two cautions. First, `notifications` has no index on `created_at` alone, so the batch query would scan; add one, or partition the table by month and drop whole partitions (the cheapest delete there is). Second, check retention against the bank's record-keeping policy. Notifications contain no customer data and the audit trail already records the underlying events, so short retention is normally acceptable, but it is a policy decision.

---

## 5. What to build next

| Improvement | Benefit | Effort |
|---|---|---|
| Index `notification_reads (user_id, notification_id)` | 4 to 7 times faster inbox and count once read state grows (measured) | One migration |
| Retention (90 days, batched or partitioned) | Bounded table sizes; every query stays fast | A scheduled job, plus an index or partitioning |
| `UNION ALL` inbox query | Cost independent of history size (measured) | A query change and a test |
| **"Read up to" watermark** instead of per-row markers for "mark all" | "Mark all read" writes one row (`user_id, read_before`) instead of thousands; individual reads stay per row | Schema and query change: unread = created after the watermark and not individually read |
| A dedicated `action_needed` type for "contact the customer directly" | Correct semantics for filtering and display | Small ([producers](producers.md#5-things-to-notice-and-possible-improvements)) |
| A CHECK on `type` | The database enforces the six types | One migration |
| Per-user preferences (mute a type) | Less noise for supervisors | A preferences table consulted in the audience SQL |
| Email / Teams digest for unread notifications | Reach people who are not in the console | A worker using the outbox, respecting preferences |
| One shared definition of the audience rule | SQL and the in-memory `dispatch` match cannot drift ([live push](live-push.md#dispatch-the-in-memory-audience-match)) | A unit test that runs both against the same cases |
| A Playwright test for the bell | End-to-end proof in a real browser | One test |

---

## 6. Limits summary (for interviews)

> The design is correct, secure and atomic, but it was built for clarity first. Three things would bite at scale: read state is per row, so "mark all read" writes thousands of rows and the read table outgrows the notifications table; that table has no index by user, so every inbox and unread count scans it, which I measured going from 5 ms to about 30 ms at 343,000 rows and back to 4 ms with one index; and nothing is ever deleted. The fixes are an index, a 90-day retention job, and possibly a "read up to" watermark for mark-all. I would also add a CHECK on the type and a browser test.
