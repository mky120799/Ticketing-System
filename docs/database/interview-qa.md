# Database interview Q&A

[Back to Database index](README.md) · Study first: [Transactions](transactions.md), [MVCC and isolation](mvcc-and-isolation.md), [Locking](locking-and-concurrency.md)

Questions run from fundamentals to senior design, and every answer is grounded in this project, because "here is how I did it, and here is the trade-off" beats a textbook definition in an interview. Answers are written to be **said aloud**: short first sentence, then the reason, then the evidence.

---

## How to answer database questions

1. **Name the mechanism** with its proper term ("a unique constraint used as a claim").
2. **Say what it guarantees**, and what it does not.
3. **Point at the code** ("`ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id` in the escalation service").
4. **Name the honest gap** if one exists. Interviewers trust candidates who know the limits of their own system.

---

## 30-second and 2-minute answers

**"Tell me about the database side of your project."**

> PostgreSQL is the single source of truth. Every use case runs in one transaction on one pooled connection, so the business change, its audit event, its outbox event and its live-update signal commit or vanish together. We run at READ COMMITTED and add the right primitive where a read-check-write matters: row locks, `SKIP LOCKED` queues, advisory locks, unique constraints as claims, leases. The schema enforces its own rules with checks, foreign keys and append-only triggers, evolves through migrations run by an owner account, and the app runs as a restricted account that cannot rewrite audit.

For two minutes, add: the pool's three timeouts and the failure each prevents; the outbox instead of distributed transactions; keyset paging on a composite index; and the gaps (lost updates on ticket edits, the first-use idempotency race, a missing FK index).

---

## Level 1: Fundamentals

**Q1. What is a primary key, and why do you use UUIDs?**
> A primary key uniquely identifies a row and can never be NULL. We generate UUIDs in code before inserting, so the new ticket's ID is known up front and can be written into its references, audit and outbox rows in the same transaction. They also do not leak volume or let anyone guess the next ticket. The audit table is the exception: it has a `bigserial` sequence because the hash chain needs a strict order.

**Q2. Natural key vs surrogate key?**
> A surrogate key has no business meaning (a random UUID); a natural key already identifies the thing (`queue_key = 'payments'`). We use surrogates for things the app creates and natural keys for named configuration. Composite natural keys carry business rules: `intake_messages (channel, message_id)` *is* the rule "one email, one ticket".

**Q3. What is a foreign key? What do RESTRICT and CASCADE mean?**
> A foreign key guarantees a reference points at an existing row. On deleting the parent, RESTRICT refuses and CASCADE deletes the children. Case evidence (notes, history, attachments) is RESTRICT because it must never disappear by accident; read markers and notifications are CASCADE because they mean nothing without their parent.

**Q4. Does PostgreSQL index foreign keys automatically?**
> No. Only the referenced side has an index. I found 15 unindexed FK columns in our schema; one matters, `ticket_references.ticket_id`, which the detail view queries. With 100,000 rows the lookup was a 6 ms sequential scan versus 0.09 ms with an index.

**Q5. What is normalisation? When do you denormalise?**
> Storing each fact once so copies cannot disagree. We denormalise for snapshots (escalations record the queue *at the time*) and for hot queries (tickets carry their legal entity and country so access filters and the paging index need no join).

**Q6. `varchar(n)` or `text`? Native `ENUM` or a CHECK?**
> In PostgreSQL they store the same; `varchar(n)` adds a length guard, which we use for controlled values. For allowed values we use `varchar` plus a CHECK, because a CHECK can be dropped and re-added in a migration while enum values are awkward to change.

**Q7. `timestamp` or `timestamptz`?**
> Always `timestamptz`: it stores an absolute instant. A bank working in Sydney and Mumbai cannot have "09:00" mean two different moments. The only `date` column is a public holiday, which really is a calendar day.

**Q8. When is `jsonb` appropriate?**
> For data whose shape you cannot know in advance: the bank-defined `custom_fields`. If you will filter, join or constrain on it, it should be a column.

**Q9. What is a view, and how do you use one?**
> A stored query that looks like a table. The `reporting` views expose classifications and dates but no free text, and because a view checks the *owner's* privileges on the underlying tables, the BI account can read the view with no access to `tickets` at all.

**Q10. How do you prevent SQL injection?**
> Every value is a `$n` parameter; the driver sends SQL text and values separately, so a value can never become code. The few fragments built in code (an `ORDER BY`, a `CASE` expression, a table name) are fixed strings, each commented as never coming from input.

---

## Level 2: Transactions

**Q11. What does ACID mean? Give an example of each from your code.**
> Atomicity: a status change's history row is rolled back if the root-cause check throws afterwards. Consistency: constraints hold at every commit. Isolation: readers never see a half-done status change. Durability: COMMIT returns only after the write-ahead log is flushed.

**Q12. How do you make a business change and its audit atomic?**
> `PgService.transaction` gives one `PoolClient`; the update, the audit insert, the outbox insert and `pg_notify` all use it. Any throw rolls everything back. That is why `AuditService.write` and `OutboxService.enqueue` take a client parameter.

**Q13. What is the "same client" rule, and what goes wrong if you break it?**
> A transaction only covers statements on its own connection. A `this.db.query` inside the callback runs on another connection in autocommit mode, so it commits even if the transaction rolls back, and it cannot see the transaction's uncommitted changes.

**Q14. Walk me through your transaction helper.**
> Borrow one connection; `BEGIN`; run the callback; `COMMIT` and return. On any error, `ROLLBACK` and re-throw so NestJS maps it to the right status. In `finally`, always release the connection, so errors never leak connections.

**Q15. What happens if a statement fails inside a transaction and you catch the error?**
> PostgreSQL marks the transaction aborted and refuses every later statement ("current transaction is aborted"). You must roll back, or use a savepoint around the risky statement. Our code catches and re-throws; where it swallows errors, as in the customer-reply path, the swallowed error is a JavaScript error, not a SQL one, so the transaction is still usable.

**Q16. Why not hold the transaction open while calling S3, Kafka or SMTP?**
> An open transaction holds a scarce pooled connection, its locks, and an old snapshot that blocks vacuum. A slow network call would hold all three. We presign after commit, publish between claim and mark transactions, and send email after a lease commit.

**Q17. Why does that matter more in your system than most?**
> The audit chain uses one advisory lock for every audited write, held until commit. So all audited transactions system-wide are serialised from their first audit write to commit. Anything slow after that point caps the throughput of the whole product, which is why the idle-in-transaction timeout is critical.

**Q18. How do you publish to Kafka reliably without distributed transactions?**
> The transactional outbox: the event row is inserted in the same local transaction as the change, and a dispatcher publishes it afterwards. An event exists if and only if its change committed. Publishing is at least once, so consumers deduplicate by event ID.

**Q19. What is two-phase commit and why not use it?**
> A coordinator asks every participant to prepare, then to commit. Kafka does not participate with PostgreSQL, and 2PC is slow and can leave participants blocked holding locks if the coordinator fails between phases.

**Q20. Is `PgService.query()` transactional?**
> Each statement is atomic on its own (autocommit). That is enough for one-statement operations like the inbox query or `markRead`'s single `INSERT ... SELECT`. Two statements that must agree need `transaction()`.

---

## Level 3: Connections and the pool

**Q21. Why a connection pool?**
> PostgreSQL starts a process per connection and has a hard `max_connections` (100 on our container). Opening one per request is slow and exhausts the limit under load. One bounded pool of 20 per API process reuses connections.

**Q22. Explain each pool timeout.**
> `connectionTimeoutMillis` (10 s): a request waiting for a free connection fails instead of hanging forever. `statement_timeout` (60 s): a runaway query is cancelled. `idle_in_transaction_session_timeout` (60 s): a session sitting silent inside an open transaction is killed, which releases its locks; without it, one stuck request holding the audit lock would freeze every audited write.

**Q23. What is a pool deadlock?**
> Every pooled connection is held by a request that is waiting for *another* connection from the same pool, so none is ever returned. `nextStatuses` takes an optional client so the ticket detail path does not borrow a second connection inside its transaction.

**Q24. Why is the LISTEN connection separate from the pool?**
> `LISTEN` belongs to a session. A pooled connection would be reused or closed, silently dropping the subscription, and holding it forever would shrink the pool. It reconnects with backoff and tells browsers to resync after a gap.

**Q25. How many API instances can you run?**
> Each uses up to 21 connections (20 pooled plus the listener). Against 100, four instances is tight once admins and BI connect. Options: smaller pools per instance, more `max_connections`, or PgBouncer with the listener bypassing it.

**Q26. What breaks under PgBouncer transaction pooling?**
> Anything tied to a session: `LISTEN`, session-level advisory locks, and settings sent at connect time. We use only transaction-level advisory locks, so those are fine; the listener must connect directly, and the timeouts should move onto the database role.

---

## Level 4: MVCC and isolation

**Q27. What is MVCC?**
> PostgreSQL never overwrites a row: an UPDATE writes a new version and marks the old one dead. Each transaction reads from a snapshot of committed versions, so readers never block writers and writers never block readers.

**Q28. What does an UPDATE physically do?**
> It inserts a new row version at a new `ctid` with a new `xmin`, and sets `xmax` on the old version. The old one stays on disk until VACUUM reclaims it. You can watch `ctid` move with `SELECT xmin, xmax, ctid`.

**Q29. What isolation level do you use, and why is that OK?**
> READ COMMITTED, the default. It never raises serialization failures, so services need no retry loops, and its statement-level re-check makes atomic increments, conditional updates and upserts safe. Where read-check-write matters, I add an explicit lock or a conditional `WHERE`.

**Q30. Difference between READ COMMITTED and REPEATABLE READ?**
> When the snapshot is taken: per statement versus once per transaction. In a lab, a second read in the same transaction returned 99 at READ COMMITTED and still 10 at REPEATABLE READ.

**Q31. Name the concurrency anomalies.**
> Dirty read (never in PostgreSQL), non-repeatable read, phantom, lost update, write skew. READ COMMITTED allows the last four; REPEATABLE READ stops all but write skew (PostgreSQL also stops phantoms there); SERIALIZABLE stops all of them by aborting a transaction.

**Q32. Show me a lost update.**
> Two sessions read `n = 0`, each computes `0 + 1` in code, each writes 1. Two increments, final value 1, no error. Fixes: `SET n = n + 1`, `SELECT ... FOR UPDATE`, or a conditional `WHERE version = $seen` that updates zero rows for the loser.

**Q33. Why does `SET n = n + 1` work at READ COMMITTED but read-then-write does not?**
> When an UPDATE waits for another transaction's row lock, READ COMMITTED re-reads the latest committed version and re-evaluates the expression and the WHERE on it. `n + 1` is computed from the new value; a value computed earlier in application code is not.

**Q34. What is write skew? Give an example.**
> Two transactions each check a rule over the same rows, then each change a different row, together breaking it. Two on-call doctors each see "two on call" and each go off call: zero remain. Only SERIALIZABLE (or an explicit lock on a shared row) prevents it.

**Q35. What is a serialization failure and how do you handle it?**
> Under REPEATABLE READ or SERIALIZABLE, PostgreSQL aborts a transaction with SQLSTATE `40001` rather than allow an anomaly. The application must retry the whole transaction, so you need a retry loop wherever you use those levels.

**Q36. Where would you use REPEATABLE READ in this project?**
> For consistent multi-query reads: a dashboard whose aggregates must add up, or the ticket detail view so the ticket and its children come from one instant. Read-only transactions never get serialization failures.

---

## Level 5: Locking

**Q37. When do you use `FOR UPDATE` vs `SKIP LOCKED`?**
> `FOR UPDATE` when I must act on *this* row and others should wait: an approval decision. `SKIP LOCKED` when any available row will do: work queues, so workers never block each other or users.

**Q38. How does the outbox stop two dispatchers publishing the same event?**
> One statement: a CTE selects due events `FOR UPDATE SKIP LOCKED`, and an `UPDATE ... FROM` marks them `in_flight` and returns them. `SKIP LOCKED` separates concurrent claims; the status separates claims after commit; `claimed_at` lets a sweep recover rows from a crashed dispatcher.

**Q39. What is an advisory lock and where do you use it?**
> A lock on a number with no row behind it. I use it for the audit chain head, per-queue assignment (`hashtext('assign:'+queue)`), and per-message intake; and a try variant elects one scheduler instance per tick.

**Q40. Why only `xact` advisory locks?**
> They release automatically at commit or rollback. Session locks survive in a pooled connection if you forget to unlock, and the next unrelated request inherits them.

**Q41. Why does intake need an advisory lock rather than `FOR UPDATE`?**
> On the first delivery there is no row to lock yet. Without the lock, two redeliveries both find no ledger row and both create a ticket. With it, the second waits, then finds the ledger row and returns the original.

**Q42. How is escalation idempotent across instances?**
> Three layers: a `NOT EXISTS` candidate filter, a `FOR UPDATE` re-read of the ticket, and the claim `INSERT ... ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id`. Zero rows back means someone else did it.

**Q43. Why is a unique constraint safe where "check then insert" is not?**
> The check-then-insert has a gap both requests can pass. A unique index is checked atomically: the second insert waits for the first, then fails or does nothing. Exactly one wins.

**Q44. What is a lease?**
> A time-limited claim stored in the row: the delivery worker pushes `next_attempt_at` 120 seconds ahead, commits, then sends. A crash just lets the lease expire. The limit: a crash after a successful send means it is sent again, so delivery is at least once.

**Q45. `FOR UPDATE` vs `FOR NO KEY UPDATE`?**
> `FOR UPDATE` also conflicts with the `KEY SHARE` lock a foreign-key insert takes on its parent, so locking a ticket `FOR UPDATE` blocks inserting its notes (1.25 s wait in a lab). If you will not change the key, `FOR NO KEY UPDATE` gives the same protection without that blocking.

**Q46. How do deadlocks happen and how do you prevent them?**
> Two transactions take the same locks in opposite orders. PostgreSQL detects it after about a second and aborts one. Prevent it with a consistent lock order; here, take row locks before the first audit write, since the audit lock is global.

**Q47. How would you find what is blocking a query in production?**
> `pg_stat_activity` with `pg_blocking_pids(pid)` to see who blocks whom, `pg_locks` for the lock details, and look for long `idle in transaction` sessions, which are the usual culprit.

---

## Level 6: Indexes and performance

**Q48. How does a B-tree index work?**
> A balanced, sorted tree of (value, row address) pairs. Inner pages route the search, linked leaf pages hold the entries in order, so equality, ranges and ordered reads take a few page reads. It cannot search the middle of a string.

**Q49. Explain your paging index.**
> `(legal_entity, country, queue, created_at DESC, id DESC)`. Equality columns first, then the sort columns in the `ORDER BY` direction, so the first page is a read of 51 entries with no sort; `id` breaks ties because rows in one transaction share `created_at`.

**Q50. Why keyset pagination instead of OFFSET?**
> Constant cost and stable pages. Measured 8,000 rows deep: keyset touched 4 pages and 51 entries, OFFSET read 8,051 entries. And inserts above the bookmark do not shift pages.

**Q51. What did you learn from measuring it?**
> With several queues (`queue = ANY(...)`) the index is no longer in one sorted run, so PostgreSQL reads every matching entry (16,668) and does a top-N sort. Fine at 5 ms; if it grew, I would query per queue and merge, or reorder the index.

**Q52. What is a partial index? Give examples.**
> An index with a WHERE clause. `ticket_communications (next_attempt_at) WHERE status='queued'` stays tiny however many messages have been delivered, and serves the delivery worker exactly.

**Q53. How do you read EXPLAIN ANALYZE?**
> Inside out; compare actual rows to what you expected; look at `Buffers` for work done and `Rows Removed by Filter` for wasted reads, which usually means a missing or wrong index.

**Q54. Your search uses `ILIKE '%term%'`. Is that a problem?**
> A B-tree cannot help with a leading wildcard, so it filters the user's queue rows (8,335 to find 3 in a lab, 17 ms). For scale: a `pg_trgm` GIN index or full-text search.

**Q55. Why avoid rewriting rows that have not changed?**
> Every UPDATE creates a new version and a dead tuple, fires audit, and bumps `updated_at`. The SLA job's `IS DISTINCT FROM` guard updates only rows whose status actually changes.

---

## Level 7: Schema change, roles and operations

**Q56. How do migrations work in this project?**
> node-pg-migrate applies numbered files in order and records them in `pgmigrations`. By default all pending migrations run in one transaction (PostgreSQL can roll back DDL) and under a lock, so two migration jobs cannot collide.

**Q57. How do you change a busy table safely?**
> Avoid long exclusive locks: `CREATE INDEX CONCURRENTLY`, constraints `NOT VALID` then `VALIDATE`, batched backfills, a `lock_timeout`, and expand-migrate-contract for renames so the previous release keeps working while the migration runs before the new one.

**Q58. How do you stop the application rewriting the audit trail?**
> Migrations run as the owner; the app runs as `case_app` with UPDATE, DELETE and TRUNCATE revoked on audit tables, plus append-only triggers. A startup check reads the database's own privilege report and refuses to start if the app could tamper.

**Q59. What is VACUUM and why does it matter for you?**
> It reclaims dead row versions left by MVCC. Our outbox updates every event twice (14,198 events produced 28,396 updates locally), and long transactions stop vacuum database-wide, so we keep transactions short and would tune autovacuum on the outbox.

**Q60. What grows forever, and what would you do?**
> Published outbox rows, notifications and read markers, idempotency ledgers. Batched retention deletes, or monthly partitions you drop.

**Q61. How would you back up and recover?**
> Base backups plus continuous WAL archiving for point-in-time recovery, with agreed RPO and RTO and tested restores. Audit anchors stored outside the database let us verify a restored chain.

**Q62. Would you add read replicas?**
> Only with a measured need. Replicas lag, cannot take locks or writes, and do not receive NOTIFY. All our coordination assumes one primary; the API scales horizontally on top of it.

---

## Follow-up traps

| Trap | Good answer |
|---|---|
| "So your system is exactly-once?" | No. Inside PostgreSQL, changes and their evidence are atomic. Across Kafka, email and storage it is at least once, made safe by idempotency keys and unique receipts |
| "SERIALIZABLE would fix all your concurrency issues, right?" | It prevents anomalies by aborting, so every transaction would need a retry loop, and contention becomes errors. Targeted locks at READ COMMITTED are simpler here |
| "Doesn't `expectedUpdatedAt` give you optimistic locking?" | It catches stale browsers, but the comparison is in JavaScript before an unconditional UPDATE. Two simultaneous requests both pass. The fix is the condition in the `WHERE` |
| "Why not just catch the unique violation?" | Fine as a last resort, but the transaction is then aborted; you must re-throw (or use a savepoint). `ON CONFLICT DO NOTHING` avoids the error entirely |
| "Indexes make everything faster?" | They make the reads they match faster and every write slower. The lab showed an index (`branch_code, created_at`) with zero scans: pure write cost |
| "Seq Scan means a missing index?" | Not on a small table. On a six-row outbox, one page read beats an index descent |

---

## Honest limitations to volunteer

- **Lost updates** on general ticket edits: conditional `UPDATE ... AND updated_at = $expected`, zero rows → 409, proven with a two-connection test.
- **First-use idempotency race** on staff create returns a 500 to the loser: advisory lock like intake, or catch `23505` and replay.
- **Missing FK index** on `ticket_references(ticket_id)`.
- **`FOR UPDATE` where `FOR NO KEY UPDATE` suffices**, blocking child inserts.
- **No retention** for published outbox rows and notifications.
- **Retention deletes files before the locked re-check**, a cross-store race.
