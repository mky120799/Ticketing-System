# Running PostgreSQL in production

[Back to Database index](README.md) · Previous: [Migrations and roles](migrations-and-roles.md) · Next: [Hands-on labs](hands-on-labs.md) · Related: [Operations](../operations/README.md)

Writing correct SQL is half of database work. The other half is keeping the database healthy as data grows for years: cleaning up after MVCC, watching for slow queries and stuck transactions, scaling connections, and being able to restore. This page covers those concerns for this project, with numbers from the project's own local database where they help.

---

## 1. VACUUM, dead rows and bloat

### Why there is garbage at all

[MVCC](mvcc-and-isolation.md#2-row-versions-xmin-xmax-ctid) never overwrites a row: an UPDATE writes a new version and marks the old one dead, and a DELETE marks a version dead. Dead versions (**dead tuples**) still occupy space in the table and its indexes until **VACUUM** reclaims it.

`VACUUM` scans a table, finds versions no running transaction can still see, and marks their space reusable. It does not normally shrink the file; it makes room for new rows inside it. `VACUUM FULL` does shrink the file, by rewriting the whole table under an exclusive lock, so it is a maintenance-window operation.

**Autovacuum** is a background process that runs `VACUUM` (and `ANALYZE`, which refreshes planner statistics) on tables once enough rows have changed. Its default trigger is roughly "20% of the table's rows are dead", which is fine for most tables and too lazy for very large or very hot ones.

### Bloat

If dead tuples are produced faster than vacuum reclaims them, the table **bloats**: it is much bigger on disk than its live data, so scans read more pages, indexes grow, and the cache holds less useful data.

### What stops vacuum: long transactions

Vacuum can only remove a dead version once **no** transaction might still need it. One transaction that has been open for an hour (a forgotten `psql` session, a report, a stuck request) holds back cleanup **for the whole database** for that hour. This is a third reason, alongside locks and connections, why [transactions must be short](transactions.md#7-keep-transactions-short) and why `idle_in_transaction_session_timeout` exists.

### The tables that matter here

The project's local database after normal development use:

```text
       relname        | n_live_tup | n_dead_tup | n_tup_upd
 integration_outbox   |      14198 |        384 |     28396
 tickets              |       3483 |         74 |     10526
```

`integration_outbox` shows the outbox's write pattern exactly: **two updates per event** (claimed → `in_flight`, then → `published`), so 14,198 events produced 28,396 updates and as many dead tuples over time. Autovacuum is keeping up. `tickets` is updated about three times per row on average (status changes, SLA reconciliation, assignment), which is why the SLA job's `IS DISTINCT FROM` guard ([SQL patterns 15](sql-patterns.md#15-is-distinct-from-null-safe-comparison-and-skipping-no-op-writes)) matters: without it, every tick would rewrite every open ticket.

Practical tuning for a busy outbox: lower the per-table autovacuum threshold (`ALTER TABLE integration_outbox SET (autovacuum_vacuum_scale_factor = 0.01)`) so it is vacuumed after 1% churn, not 20%.

### Transaction ID wraparound (know the name)

PostgreSQL transaction IDs are 32-bit and wrap around. Vacuum periodically **freezes** old rows so they stay visible forever. If freezing falls badly behind (usually because of a very long transaction or disabled autovacuum), PostgreSQL eventually stops accepting writes to protect data. Monitor `age(datfrozenxid)` (it was 48,917 in the lab, against a danger zone around two billion). With autovacuum on and no hours-long transactions, you will not get near it.

---

## 2. Growth: tables that are never cleaned up

Some tables only ever grow. Sizes on the local database:

```text
 audit_events          | 35 MB    (41,551 events for 3,483 tickets, about 12 per ticket)
 integration_outbox    | 7304 kB  (14,198 events, all 'published', none removed)
 notifications         | 4512 kB  (17,397 notifications, about 5 per ticket)
```

| Table | Why it grows | Current cleanup | Recommendation |
|---|---|---|---|
| `audit_events` | append-only evidence | an owner-run archive procedure moves old events out, leaving a chain base ([audit integrity](../audit/integrity-and-anchors.md)) | keep; archive on a schedule |
| `integration_outbox` | every business event | **none**: published rows stay forever | delete (or archive) `published` rows older than N days in small batches; or partition by month and drop old partitions |
| `notifications` + `notification_reads` | every assignment, approval, SLA breach | **none** (only cascade when a ticket is deleted, which never happens) | retention, for example 90 days ([notifications: performance](../notifications/performance-and-limits.md)) |
| `idempotency_records`, `intake_messages` | every create / inbound message | none | keep long enough to cover realistic retries (days), then trim |
| `ticket_status_history`, notes | case history | redacted by retention, not removed | keep with the case |

Large deletes create dead tuples too, so do them in batches (`DELETE ... WHERE id IN (SELECT id ... LIMIT 1000)` in a loop) and let vacuum keep up. For tables that are purely time-ordered and very large, **declarative partitioning** (one child table per month) turns "delete a month" into an instant `DROP TABLE` of one partition.

---

## 3. PgBouncer, and what it would break

When instances × pool size approaches `max_connections` ([connection pool, section 6](connection-pool.md#6-sizing-how-many-connections-in-total)), the standard answer is **PgBouncer**: a lightweight proxy that accepts thousands of client connections and multiplexes them onto a small number of real server connections.

It has three modes. **Session pooling** gives a client a server connection for its whole session (little gain over today). **Transaction pooling** gives a server connection only for the duration of each transaction, then hands it to someone else: that is where the big gain is, and where the caveats are. **Statement pooling** is stricter still and breaks multi-statement transactions.

Under **transaction pooling**, anything that relies on *session* state breaks, because consecutive transactions from one client may run on different server connections:

| Feature | Used here? | Effect under transaction pooling |
|---|---|---|
| `LISTEN` | **yes**, live updates ([live-events.service.ts#L91](../../apps/api/src/live/live-events.service.ts#L91)) | **Breaks.** The subscription lives on one server session. Keep the listener connecting **directly** to PostgreSQL, bypassing PgBouncer |
| Session advisory locks (`pg_advisory_lock`) | no (only `xact` forms) | Would break; the `xact` forms used here are fine because they end with the transaction |
| Session settings sent at connect (`statement_timeout`, `idle_in_transaction_session_timeout`) | **yes**, via the pool config ([pg.service.ts#L12-L13](../../apps/api/src/database/pg.service.ts#L12-L13)) | May not apply per client. Set them on the database role instead: `ALTER ROLE case_app SET statement_timeout = '30s'` |
| Named prepared statements | no (the `pg` driver uses unnamed statements unless you name them) | Fine |
| `pg_notify` inside transactions | yes | Fine: it is part of the transaction |

So PgBouncer is a viable next step, with two changes: a direct connection for the LISTEN client, and timeouts moved onto the role.

---

## 4. Monitoring: what to look at

### Inside PostgreSQL

All of these run on PostgreSQL 16 (checked against the lab database):

```sql
-- What are sessions doing right now?
SELECT state, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;

-- Transactions left open: the audit-lock and vacuum danger
SELECT pid, now() - xact_start AS in_transaction_for, state, left(query, 60) AS query
FROM pg_stat_activity
WHERE state = 'idle in transaction' AND now() - xact_start > interval '5 seconds';

-- Who is blocked, and by whom?
SELECT pid, pg_blocking_pids(pid) AS blocked_by, wait_event_type, left(query, 60) AS query
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- Dead tuples, vacuum, and whether tables are scanned sequentially
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, seq_scan, idx_scan
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;

-- Indexes never used since statistics were reset (candidates to drop: each one slows writes)
SELECT relname AS table, indexrelname AS index, idx_scan
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;

-- Biggest tables, including indexes and TOAST
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;

-- Share of page reads served from memory (aim for 99%+ on an OLTP database)
SELECT round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) AS cache_hit_pct
FROM pg_stat_database WHERE datname = current_database();
```

The **unused index** query is worth a word. In the lab it listed `tickets_branch_code_created_at_index` with zero scans. That index (from migration 0000) has no current query that obviously needs it. On a production database with weeks of statistics, an index that is still at zero is costing write time for nothing. (Be careful: unique indexes enforce constraints even if never scanned, so `audit_events_id_key` must stay.)

### `pg_stat_statements`: the most useful extension

`pg_stat_statements` records every distinct query shape with call counts, total and mean time, and rows. "Which queries consume the most total time?" becomes one `SELECT ... ORDER BY total_exec_time DESC`. It must be loaded at server start (`shared_preload_libraries`), and managed services such as Amazon RDS enable it with a parameter. It is the first thing to switch on in production.

### From the application

| Signal | Meaning |
|---|---|
| `timeout exceeded when trying to connect` | the pool was saturated for 10 s ([connection pool](connection-pool.md#3-the-three-timeouts-and-the-failures-they-prevent)) |
| `canceling statement due to statement timeout` | a query needs an index or a rewrite |
| `terminating connection due to idle-in-transaction timeout` | a request held a transaction open while not talking to the database |
| `deadlock detected` | two transactions took locks in different orders ([locking, section 8](locking-and-concurrency.md#8-deadlocks)) |
| Outbox backlog (pending + retry count) and dead letters | the dispatcher or Kafka is unhealthy ([observability metrics](../observability/metrics.md)) |

---

## 5. Backups and point-in-time recovery

Two kinds of backup, and a production system needs the second.

**Logical backup (`pg_dump`).** Exports tables as SQL or a custom archive. Portable and simple, good for copying a database to a test environment. But it is a snapshot at one moment: restore it and you lose everything since.

**Physical backup + WAL archiving.** A **base backup** is a copy of the data files. With **WAL archiving**, every write-ahead-log segment is also copied somewhere safe as it fills. To recover, restore the base backup and **replay the WAL** up to any moment you choose: this is **point-in-time recovery (PITR)**. "Restore to 14:02, just before the bad deployment" becomes possible. Managed services (Amazon RDS and Aurora, for example) do this automatically, with a retention window.

The two numbers to agree with the bank:

- **RPO** (recovery point objective): how much data you can afford to lose. With continuous WAL archiving, seconds.
- **RTO** (recovery time objective): how long recovery may take. Depends on database size and replay speed; **measure it by doing test restores**.

A backup you have never restored is a hope, not a backup. The project's DR plan, including what is and is not in the database (file bytes live in object storage and need their own backup), is in [operations/disaster-recovery.md](../operations/disaster-recovery.md).

For this product specifically, the audit **anchors** stored outside the database mean a restored database can be verified: if a restore (or an attacker) dropped recent audit events, verification against the external anchors detects it.

---

## 6. Replication and high availability

**Streaming replication** keeps one or more **standby** servers continuously replaying the primary's WAL. If the primary fails, a standby is **promoted** and becomes the new primary (managed services automate this as "Multi-AZ" failover).

Standbys can also serve **read-only** queries (read replicas). Before routing any reads to a replica in this codebase, know the limits:

- **Replication lag.** A replica is a little behind. A user who updates a ticket and immediately re-reads it from a replica may see the old version.
- **No writes, no locks.** `FOR UPDATE`, advisory locks, and every transaction that writes must go to the primary. All of the [locking](locking-and-concurrency.md) in this project assumes one primary.
- **No LISTEN/NOTIFY across servers.** Notifications are delivered only to sessions on the primary.

The project currently runs everything against **one primary** ([disaster-recovery.md](../operations/disaster-recovery.md)), which is the right default: the API and workers scale horizontally (they coordinate through the database's locks), and the database scales vertically until there is a measured reason to do more.

---

## 7. Security in production (database layer)

| Control | How |
|---|---|
| Least-privilege runtime account | `case_app` from [roles.sql](../../infra/postgres/roles.sql), enforced at startup with `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` ([migrations and roles](migrations-and-roles.md#5-roles-owner-app-reporting)) |
| Separate migration account | `MIGRATION_DATABASE_URL` used only by the migration job |
| Encrypted connections | `?sslmode=verify-full` in the connection string so the client verifies the server's certificate |
| Encryption at rest | the managed service's storage encryption (KMS keys on AWS) |
| Secrets | connection strings from a secret store (Kubernetes secrets referenced by the Helm chart), never in images |
| Network | the database reachable only from the API's network, never from the internet |
| No content in reporting | BI tools use `case_reporting` and the `reporting` views only |

---

## 8. Production checklist

- [ ] App runs as `case_app`; `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true`
- [ ] Timeouts tightened (idle-in-transaction 5 to 15 s, statement 15 to 30 s), set on the role if PgBouncer is used
- [ ] `pg_stat_statements` enabled and reviewed weekly
- [ ] Alerts on: idle-in-transaction > 10 s, blocked sessions, connection count > 80% of `max_connections`, replication lag, outbox backlog, dead letters
- [ ] Autovacuum tuned for `integration_outbox`; retention jobs for outbox, notifications, idempotency ledgers
- [ ] Missing FK index on `ticket_references(ticket_id)` added (`CONCURRENTLY`)
- [ ] PITR enabled; restore tested and timed; object-storage backups aligned
- [ ] TLS with certificate verification on every connection

Next: [Hands-on labs](hands-on-labs.md)
