# Database concepts glossary

[Back to Database index](README.md)

Every term used in this folder. Each entry gives the **technical term**, a **plain meaning**, an **analogy** where one helps, and **where it shows up in our code**. Read it once top to bottom, then come back to it whenever a page uses a word you are unsure of.

The entries are grouped in the order the course teaches them, so the earlier entries never depend on later ones.

---

## 1. Storing data

**Relational database.** A database that stores data as *relations* (tables) and lets you combine them by matching values. Plain: a set of spreadsheets that know how they relate to each other and refuse bad edits. Ours is PostgreSQL 16 ([docker-compose.yml#L2-L4](../../docker-compose.yml#L2-L4)).

**Table / row / column.** A table is one kind of thing (tickets). A row is one instance (one ticket). A column is one attribute every row has (its `status`). Plain: a table is a spreadsheet tab, a row is one line on it, a column is one heading. Example: [`tickets` in migration 0000](../../apps/api/migrations/1710000000000_initial.cjs#L3).

**Schema.** Two meanings. (1) The *shape* of the database: which tables and columns exist. (2) A *namespace*, a folder for tables: we have `public` (everything) and `reporting` (views for BI tools). Plain: the blueprint, or a folder inside the database.

**Data type.** What kind of value a column holds and what operations make sense on it. Plain: a promise that "this column only ever holds dates" so the database can sort, compare and validate correctly. Our main types are explained in [Data types and modelling](data-types-and-modelling.md).

**NULL.** "No value / unknown." It is not zero and not an empty string. Any comparison with NULL using `=` gives *unknown*, not true or false, which is why SQL has `IS NULL` and `IS DISTINCT FROM`. Plain: a blank box on a form, not a box with "0" written in it. Example: `assigned_to` is NULL while a ticket is unassigned.

**Primary key (PK).** The column (or columns) that uniquely identifies a row, never NULL, never repeated. Plain: the ticket's reference number. Example: `tickets.id uuid PRIMARY KEY`.

**Composite key.** A primary key made of several columns together. Plain: neither "first name" nor "date of birth" is unique alone, but the pair might be. Example: `idempotency_records (actor_id, idempotency_key)` ([migration 0000#L7](../../apps/api/migrations/1710000000000_initial.cjs#L7)).

**Surrogate key vs natural key.** A surrogate key is a made-up identifier with no business meaning (a random UUID). A natural key is a value that already identifies the thing in the real world (a country code, a queue name). We use surrogates for things that are *created* (tickets, notes, notifications) and natural keys for things that are *named* (`case_queues.queue_key = 'payments'`).

**Foreign key (FK).** A column whose value must exist as a key in another table. Plain: a cross-reference that the database checks, so a note can never point at a ticket that does not exist. Example: `ticket_notes.ticket_id REFERENCES tickets`.

**Normalisation.** Designing tables so each fact is stored once. Plain: write the customer's address in one place and point to it, instead of copying it onto every form, so you never have two different addresses. [More](data-types-and-modelling.md#5-normalisation-each-fact-in-one-place).

**Denormalisation.** Deliberately copying a fact for speed or for history. Example: `ticket_escalations.from_queue` copies the queue name at the time, because the ticket's queue later changes.

**View.** A saved query that looks like a table. Plain: a window onto a table that shows only some columns. Example: `reporting.tickets` shows classifications and dates but not the subject or description ([migration 25000#L9-L12](../../apps/api/migrations/1710000025000_paging_and_reporting.cjs#L9-L12)).

---

## 2. Rules the database enforces

**Constraint.** A rule the database checks on every write and refuses to break. Plain: a bouncer on the table. Constraints are the *last line of defence*: even buggy code, a manual `psql` session, or a future service written in another language cannot violate them.

**NOT NULL.** The column must have a value.

**CHECK constraint.** A boolean expression every row must satisfy. Example: `notifications_target_chk` says a notification must have either a person or a queue+role audience ([migration 22000#L28](../../apps/api/migrations/1710000022000_notifications_and_email.cjs#L28)).

**UNIQUE constraint.** No two rows may share these values. Example: `ticket_escalations (ticket_id, rule_key)`, the thing that makes escalation happen at most once per rule.

**Partial unique index.** A uniqueness rule that only applies to some rows. Example: at most one approval per communication, but only for approvals that *have* a communication ([migration 8000#L6](../../apps/api/migrations/1710000008000_communication_approvals.cjs#L6)).

**ON DELETE RESTRICT / CASCADE.** What happens to child rows when the parent is deleted. RESTRICT: refuse the delete. CASCADE: delete the children too. Plain: RESTRICT is "you cannot shred this file while other files cite it"; CASCADE is "shredding the file also shreds its sticky notes".

**Trigger.** A function the database runs automatically before or after a change. Example: `audit_events_append_only` raises an error on any UPDATE or DELETE of audit rows ([migration 10000](../../apps/api/migrations/1710000010000_audit_immutability.cjs#L3-L8)).

---

## 3. Finding data fast

**Index.** An extra data structure that lets the database find rows without reading the whole table. Plain: the index at the back of a book. Costs: disk space, and every insert or update must also update the index.

**B-tree.** The default index type: a balanced, sorted tree. It answers equality (`=`), ranges (`<`, `>`), and "in this order" quickly. Plain: a phone book sorted by surname, then first name.

**Composite index.** An index on several columns, sorted by the first, then the second, and so on. Column order matters. Example: `tickets_paging_idx (legal_entity, country, queue, created_at DESC, id DESC)`.

**Partial index.** An index that only contains rows matching a condition. Plain: an index of only the unfinished chapters. Example: `ticket_communications_due_idx ... WHERE status = 'queued'`.

**Sequential scan (Seq Scan).** Reading every row of a table. Not always bad: for a small table it is the fastest option.

**Index scan / index-only scan / bitmap scan.** Ways of using an index. *Index scan*: walk the index, fetch each matching row from the table. *Index-only scan*: the index alone holds every column the query needs, so the table is barely touched. *Bitmap scan*: collect matching row locations from one or more indexes first, then read the table pages in physical order.

**Query planner / EXPLAIN.** The planner chooses *how* to run a query (which index, which join method) from statistics about the data. `EXPLAIN` shows the chosen plan; `EXPLAIN ANALYZE` runs it and shows real row counts and times. Plain: asking the satnav to show the route before you drive.

**Statistics / ANALYZE.** Samples of each column's values that the planner uses to estimate row counts. `ANALYZE` refreshes them (autovacuum does it automatically).

**Keyset pagination (seek method).** Paging by "rows after the last one I saw" (`WHERE (created_at, id) < ($last_created, $last_id)`), not by "skip N rows". Plain: a bookmark, instead of counting pages from the front every time. Example: [tickets.service.ts#L78-L79](../../apps/api/src/tickets/tickets.service.ts#L78-L79).

---

## 4. Transactions

**Transaction.** A group of statements that succeed or fail as one unit. Plain: a bank transfer: the debit and the credit both happen, or neither does.

**BEGIN / COMMIT / ROLLBACK.** Start a transaction; make its changes permanent and visible; throw its changes away.

**ACID.** The four guarantees of a transaction. **A**tomicity: all or nothing. **C**onsistency: constraints hold before and after. **I**solation: concurrent transactions do not see each other's half-finished work. **D**urability: once committed, it survives a crash. [Full explanation](transactions.md#1-what-a-transaction-promises-acid).

**Autocommit.** Without an explicit `BEGIN`, every statement is its own tiny transaction. `PgService.query()` runs this way.

**Aborted transaction.** After any error inside a transaction, PostgreSQL refuses every further statement until you `ROLLBACK` ("current transaction is aborted, commands ignored until end of transaction block").

**Savepoint.** A bookmark inside a transaction you can roll back to without abandoning the whole transaction. We do not use them in application code; [why that matters](transactions.md#5-errors-inside-a-transaction-the-aborted-state).

**Write-ahead log (WAL).** PostgreSQL writes every change to a sequential log on disk *before* changing the data files. On a crash it replays the log. This is how durability is achieved, and it is also what replication and point-in-time recovery read.

---

## 5. Connections

**Connection / session.** One open conversation between a client and PostgreSQL. Each connection is a separate operating-system process on the server, using several megabytes of memory. Plain: a dedicated phone line to the ledger office.

**Connection pool.** A set of already-open connections that requests borrow and return. Plain: a taxi rank instead of buying a car for every trip. Ours: up to 20 per API instance ([pg.service.ts#L8-L14](../../apps/api/src/database/pg.service.ts#L8-L14)).

**PoolClient.** One connection borrowed from the pool. A transaction lives on one `PoolClient`; statements on any other connection are outside it.

**Pool exhaustion / pool deadlock.** All connections are borrowed and requests queue. A *pool deadlock* is when the borrowers are themselves waiting for another connection from the same pool, so nobody ever returns one. [Details](connection-pool.md#4-pool-deadlock-the-trap-nextstatuses-avoids).

**statement_timeout / idle_in_transaction_session_timeout / connectionTimeoutMillis.** Limits on how long a statement may run, how long a session may sit idle inside an open transaction, and how long a request may wait for a free pooled connection. [Each explained](connection-pool.md#3-the-three-timeouts-and-the-failures-they-prevent).

---

## 6. Concurrency

**Concurrency.** Several transactions running at overlapping times. Every web server with more than one user has it.

**MVCC (multi-version concurrency control).** PostgreSQL keeps old versions of rows so readers see a consistent picture while writers create new versions. Readers never block writers and writers never block readers. Plain: instead of rubbing out an entry, the clerk writes a new dated line and crosses out the old one; people already reading still see the old line. [Deep dive](mvcc-and-isolation.md).

**Snapshot.** The set of committed transactions a statement (or transaction) is allowed to see.

**Tuple / xmin / xmax / ctid.** A *tuple* is one physical version of a row. `xmin` is the transaction that created it, `xmax` the transaction that deleted or replaced it, `ctid` its physical location. You can `SELECT xmin, xmax, ctid` on any table ([lab 2](hands-on-labs.md#lab-2-see-mvcc-row-versions)).

**Dead tuple / VACUUM / bloat.** An old row version no transaction can see any more is *dead*. `VACUUM` reclaims its space; autovacuum runs it in the background. If dead tuples pile up faster than vacuum removes them the table *bloats* (grows larger than its live data). [Details](production-operations.md#1-vacuum-dead-rows-and-bloat).

**Isolation level.** How much of other transactions' work your transaction can see. PostgreSQL offers READ COMMITTED (default, ours), REPEATABLE READ, and SERIALIZABLE.

**Anomaly.** A wrong result caused by concurrency. **Dirty read:** seeing uncommitted data (PostgreSQL never allows it). **Non-repeatable read:** reading the same row twice and getting different values. **Phantom:** re-running a query and getting new rows. **Lost update:** two read-modify-writes where one overwrites the other. **Write skew:** two transactions each check a condition, each change a *different* row, and together they break the rule.

**Serialization failure.** Under REPEATABLE READ or SERIALIZABLE, PostgreSQL aborts a transaction rather than let an anomaly happen (`could not serialize access ...`, SQLSTATE `40001`). The application must retry.

**Lock.** A claim that stops other transactions from doing something conflicting until you finish. Plain: a "currently being edited" sign.

**Row lock (`SELECT ... FOR UPDATE`).** Locks the selected rows until your transaction ends. Others trying to lock or change those rows wait.

**SKIP LOCKED.** With `FOR UPDATE`, silently skip rows someone else has locked instead of waiting. Plain: at a supermarket, go to a free till instead of queuing behind someone. The basis of every work queue here.

**Advisory lock.** A lock on a *number* rather than a row; PostgreSQL attaches no meaning to it, only our code does. Plain: a named "do not disturb" sign that only our team agrees to respect. `pg_advisory_xact_lock` waits; `pg_try_advisory_xact_lock` returns false immediately if taken. The `xact` versions release automatically at commit or rollback.

**Deadlock.** Two transactions each hold a lock the other needs; neither can proceed. PostgreSQL detects it after `deadlock_timeout` (1 second by default) and aborts one. [Lab 9](hands-on-labs.md#lab-9-cause-a-deadlock-on-purpose).

**Optimistic vs pessimistic concurrency.** *Pessimistic:* lock first, then work (`FOR UPDATE`). *Optimistic:* do not lock; at write time, check nothing changed (`WHERE updated_at = $seen`) and fail if it did.

**Idempotency.** Doing something twice has the same effect as doing it once. Achieved here with stored keys and unique constraints.

**Lease.** A time-limited claim stored in a row ("reserved until now() + 120 s"). If the worker crashes, the lease expires and someone else picks the work up. Example: [delivery.worker.ts#L48](../../apps/api/src/email/delivery.worker.ts#L48).

**LISTEN / NOTIFY.** PostgreSQL's built-in publish/subscribe. A session runs `LISTEN channel`; any transaction can `pg_notify(channel, payload)`; listeners receive it **only after that transaction commits**. Example: [live-events.service.ts#L47](../../apps/api/src/live/live-events.service.ts#L47).

---

## 7. Operations and security

**Migration.** A versioned script that changes the schema, run once per database in order. [Details](migrations-and-roles.md).

**DDL vs DML.** *Data Definition Language* changes structure (`CREATE TABLE`, `ALTER TABLE`). *Data Manipulation Language* changes rows (`INSERT`, `UPDATE`, `DELETE`). Migrations do DDL; the app does DML.

**Role / privilege / GRANT / REVOKE.** A role is a database account. Privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE) are granted or revoked per table. Example: `case_app` has UPDATE, DELETE and TRUNCATE revoked on `audit_events` ([roles.sql#L36-L40](../../infra/postgres/roles.sql#L36-L40)).

**Least privilege.** Give each account only what it needs. Plain: the cashier has the till key, not the vault key.

**SQL injection.** An attack where input is spliced into SQL text and changes its meaning. Prevented by **parameterised queries** (`$1`, `$2`): the SQL text and the values travel separately, so a value can never become code.

**Replication / replica.** A second PostgreSQL server that continuously replays the primary's WAL, ready to take over or to serve reads.

**PITR (point-in-time recovery).** Restore a base backup and replay WAL up to a chosen moment ("just before the bad deploy").

**PgBouncer.** A lightweight connection pooler that sits between apps and PostgreSQL so thousands of client connections share a few server connections. [Caveats for us](production-operations.md#3-pgbouncer-and-what-it-would-break).

Next: [Data types and modelling](data-types-and-modelling.md)
