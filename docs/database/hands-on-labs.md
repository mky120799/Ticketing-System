# Hands-on labs

[Back to Database index](README.md) · Previous: [Running PostgreSQL in production](production-operations.md) · Next: [Interview Q&A](interview-qa.md)

Reading about locks is not the same as watching one make a session wait. These 16 labs let you **see** every idea in this course happen on a copy of our real schema. Every "you should see" block below is real output, captured on the project's PostgreSQL 16 container while writing these pages. Your transaction IDs, UUIDs, process IDs and timings will differ; the shape will not.

Think of it as a flight simulator: you can crash it as often as you like, because it is a **scratch database** (`case_lab`) and never your development data (`case_platform`).

---

## Setup: a scratch copy of our schema

**What you are doing:** starting PostgreSQL, creating an empty database next to the real one, building our 37 tables in it with the real migrations, and filling it with test data.

**1. Start PostgreSQL** (only the database container is needed):

```bash
cd "<repo>"                     # note: the repository folder name ends with a space, so keep the quotes
docker compose up -d postgres
```

*How you know it worked:* `docker compose ps` shows `postgres` as `running (healthy)` after a few seconds.

**2. Point `psql` at it.** These environment variables are read by `psql` so you do not have to type them every time. `PGPORT` is **5433** because the compose file maps the container's 5432 to 5433 on your machine ([docker-compose.yml#L9](../../docker-compose.yml#L9)).

```bash
export PGHOST=localhost PGPORT=5433 PGUSER=case_user PGPASSWORD=case_password
```

No `psql` on your machine? Use the one in the container instead: replace `psql` below with `docker compose exec -T postgres psql -U case_user` (and pass files with `< file.sql`).

**3. Create the scratch database** (connecting to the built-in `postgres` database to do so):

```bash
psql -d postgres -c "DROP DATABASE IF EXISTS case_lab" -c "CREATE DATABASE case_lab"
export PGDATABASE=case_lab
```

**4. Build the schema with our real migrations:**

```bash
DATABASE_URL=postgresql://case_user:case_password@localhost:5433/case_lab npm run migration:run --workspace=@bank-case/api
```

*You should see* each migration's SQL scroll past, ending with:

```text
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1710000030000_staff_directory', NOW());
Migrations complete!
```

Then `psql -c '\dt'` lists 37 tables.

**5. Load the lab data** ([labs/seed.sql](labs/seed.sql): 50,000 tickets, 100,000 references, 20,000 notifications, and three tiny tables for the concurrency labs):

```bash
psql -v ON_ERROR_STOP=1 -f docs/database/labs/seed.sql
```

*You should see* `INSERT 0 50000`, `INSERT 0 100000`, `INSERT 0 20000`, a few `CREATE TABLE` / `INSERT` lines and `ANALYZE`.

### How to run the two-terminal labs

Labs 4 to 10 need **two sessions at once**, because concurrency needs two parties. Open two terminal windows, run the `export` lines from step 2 (and `export PGDATABASE=case_lab`) in **both**, and start `psql` in each. The instructions label them **T1** and **T2**. Type the steps in the order given. A step that "hangs" is the point: that session is waiting for a lock.

Each two-terminal lab also has a **one-shot script** version that runs both sessions in the background from one terminal, using `pg_sleep` to overlap them. That is how the outputs below were captured.

---

## Lab 1: Atomicity, all or nothing

**Idea:** a failure anywhere in a transaction undoes everything in it. ([Transactions](transactions.md#1-what-a-transaction-promises-acid))

```sql
SELECT count(*) FROM tickets;                         -- note the number (50000)
BEGIN;
INSERT INTO tickets (id,category,priority,queue,branch_code,department,legal_entity,country,subject,description,created_by)
  VALUES (gen_random_uuid(),'complaint','low','payments','BR-1','operations','BANK-IN','IN','atomic test','x','lab');
INSERT INTO audit_events (id,actor_id,action,target_type,target_id,correlation_id,outcome,event_hash)
  VALUES (gen_random_uuid(),'lab','x','ticket','t','c','success',NULL);   -- event_hash is NOT NULL: this fails
ROLLBACK;
SELECT count(*) FROM tickets;                         -- the same number again
```

*You should see:*

```text
INSERT 0 1
ERROR:  null value in column "event_hash" of relation "audit_events" violates not-null constraint
ROLLBACK
 count
 50000
```

The ticket insert **succeeded** (`INSERT 0 1`), then the audit insert failed, and the rollback removed the ticket too. This is exactly why a ticket change and its audit event can never disagree.

---

## Lab 2: See MVCC row versions

**Idea:** an UPDATE writes a new row version in a new place. ([MVCC](mvcc-and-isolation.md#2-row-versions-xmin-xmax-ctid))

```sql
CREATE TEMP TABLE demo (id int PRIMARY KEY, v text);
INSERT INTO demo VALUES (1,'a');
SELECT xmin, xmax, ctid, * FROM demo;
UPDATE demo SET v='b' WHERE id=1;
SELECT xmin, xmax, ctid, * FROM demo;
```

*You should see:*

```text
 xmin  | xmax | ctid  | id | v
 49559 |    0 | (0,1) |  1 | a
UPDATE 1
 xmin  | xmax | ctid  | id | v
 49560 |    0 | (0,2) |  1 | b
```

`ctid` moved from `(0,1)` to `(0,2)` and `xmin` (the creating transaction) changed. The old version still exists until VACUUM reclaims it. Try `UPDATE demo SET v='c'` a few more times and watch `ctid` keep moving.

---

## Lab 3: Constraints refuse bad data

**Idea:** the database enforces rules no matter who writes. ([Constraints](constraints-and-integrity.md))

```sql
-- CHECK: a ticket cannot link to itself
INSERT INTO ticket_relationships (source_ticket_id,target_ticket_id,relationship_type,created_by)
  SELECT id, id, 'duplicate', 'lab' FROM tickets LIMIT 1;

-- CHECK: a notification must have an audience
INSERT INTO notifications (id,type,title) VALUES (gen_random_uuid(),'ticket_assigned','no audience');

-- UNIQUE claim: run this exact statement twice
INSERT INTO ticket_escalations (id,ticket_id,rule_key,trigger,from_queue,to_queue)
  SELECT gen_random_uuid(), id, 'r1', 'breached', 'payments', 'fraud' FROM tickets ORDER BY id LIMIT 1
  ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id IS NOT NULL AS claimed;

-- FOREIGN KEY RESTRICT: try to delete the escalated ticket
DELETE FROM tickets WHERE id = (SELECT ticket_id FROM ticket_escalations LIMIT 1);

-- TRIGGER: audit is append-only
INSERT INTO audit_events (id,actor_id,action,target_type,target_id,correlation_id,outcome,event_hash)
  VALUES (gen_random_uuid(),'lab','x','ticket','t','c','success','h');
UPDATE audit_events SET outcome='denied';
DELETE FROM audit_events;
TRUNCATE audit_events;
```

*You should see:*

```text
ERROR:  new row for relation "ticket_relationships" violates check constraint "ticket_relationship_not_self"
ERROR:  new row for relation "notifications" violates check constraint "notifications_target_chk"
 claimed
 t                      ← first run: this transaction won the claim
(0 rows)                ← second run: already claimed, nothing inserted, no error
ERROR:  update or delete on table "tickets" violates foreign key constraint "ticket_references_ticket_id_fkey" on table "ticket_references"
DETAIL:  Key (id)=(0003048c-...) is still referenced from table "ticket_references".
INSERT 0 1
ERROR:  audit_events is append-only
ERROR:  audit_events is append-only
ERROR:  audit_events is append-only
```

---

## Lab 4: Non-repeatable read (READ COMMITTED vs REPEATABLE READ)

**Idea:** at READ COMMITTED each statement sees the latest committed data; at REPEATABLE READ the whole transaction sees one snapshot. ([MVCC, section 4](mvcc-and-isolation.md#4-read-committed-our-level))

| Step | T1 | T2 |
|---|---|---|
| 1 | `UPDATE lab_counter SET n = 10;` | |
| 2 | `BEGIN ISOLATION LEVEL READ COMMITTED;` `SELECT n FROM lab_counter;` → 10 | |
| 3 | | `UPDATE lab_counter SET n = 99;` (autocommits) |
| 4 | `SELECT n FROM lab_counter;` → **99** · `COMMIT;` | |
| 5 | Repeat steps 1 to 4 with `BEGIN ISOLATION LEVEL REPEATABLE READ;` | |

*You should see:*

```text
READ COMMITTED:  first read 10, second read 99
REPEATABLE READ: first read 10, second read 10
```

---

## Lab 5: The lost update, and three fixes

**Idea:** read-then-write in application code loses updates at READ COMMITTED; atomic updates, row locks and conditional updates do not. ([MVCC](mvcc-and-isolation.md#what-happens-when-two-transactions-update-the-same-row), [locking](locking-and-concurrency.md#2-row-locks-select--for-update))

**5a. The bug.** Both sessions read the value, think, then write back what they computed.

| Step | T1 | T2 |
|---|---|---|
| 1 | `UPDATE lab_counter SET n = 0;` | |
| 2 | `BEGIN; SELECT n FROM lab_counter;` → 0 | `BEGIN; SELECT n FROM lab_counter;` → 0 |
| 3 | `UPDATE lab_counter SET n = 1;` (0 + 1) | |
| 4 | | `UPDATE lab_counter SET n = 1;` → **hangs** (waiting for T1's row lock) |
| 5 | `COMMIT;` | the UPDATE finishes · `COMMIT;` |
| 6 | `SELECT n FROM lab_counter;` → **1** | |

Two increments happened; the counter says 1. No error anywhere.

**5b. Atomic update.** Repeat with `UPDATE lab_counter SET n = n + 1;` in both: T2 waits, then re-reads the row and computes from the new value. Final **2**.

**5c. Row lock.** Repeat 5a but read with `SELECT n FROM lab_counter FOR UPDATE;`. T2's **SELECT** now waits at step 2 until T1 commits, then sees 1 and writes 2. Final **2**.

**5d. Conditional update.** Both read `SELECT n, version FROM lab_counter;` (0, 0), then both run `UPDATE lab_counter SET n = 1, version = version + 1 WHERE id = 1 AND version = 0;`. T1 gets `UPDATE 1`. T2 waits, re-checks the WHERE against T1's committed version, and gets **`UPDATE 0`**: it knows it lost.

**One-shot script** (runs 5a from one terminal; save as `lu.sql`):

```sql
BEGIN;
SELECT n AS seen FROM lab_counter WHERE id=1 \gset
SELECT pg_sleep(1);
UPDATE lab_counter SET n = :seen + 1 WHERE id=1;
COMMIT;
```

```bash
psql -qc "UPDATE lab_counter SET n=0"
psql -qf lu.sql >/dev/null & psql -qf lu.sql >/dev/null; wait
psql -Atc "SELECT 'final n (expected 2) = ' || n FROM lab_counter"
```

(`\gset` stores the query's columns into psql variables, so `:seen` is the value this session read.) *You should see*, for the four variants:

```text
5a lost update:        final n (expected 2) = 1
5b atomic increment:   final n = 2
5c FOR UPDATE:         final n = 2      elapsed 2.08 s (the sessions ran one after the other)
5d conditional:        UPDATE 1 / UPDATE 0      final n = 1, version = 1
```

---

## Lab 6: SKIP LOCKED, two workers never take the same row

**Idea:** the outbox claim. ([Locking, section 3](locking-and-concurrency.md#3-for-update-skip-locked-the-work-queue))

```sql
INSERT INTO integration_outbox (id,event_type,aggregate_type,aggregate_id,correlation_id,payload)
  SELECT gen_random_uuid(), 'lab.event', 'ticket', 't'||g, 'c', '{}' FROM generate_series(1,6) g;
```

| Step | T1 | T2 |
|---|---|---|
| 1 | `BEGIN; SELECT aggregate_id FROM integration_outbox WHERE status='pending' ORDER BY created_at, aggregate_id FOR UPDATE SKIP LOCKED LIMIT 3;` | |
| 2 | | the same two statements |
| 3 | `COMMIT;` | `COMMIT;` |

*You should see:*

```text
worker A: t1,t2,t3
worker B: t4,t5,t6
```

Now repeat **without** `SKIP LOCKED`: T2's query hangs until T1 commits, then returns `t1,t2,t3` too. That is two dispatchers publishing the same events.

---

## Lab 7: Advisory locks and `pg_locks`

**Idea:** a lock on a number; the try variant elects one runner. ([Locking, section 4](locking-and-concurrency.md#4-advisory-locks-locking-an-idea-not-a-row))

| Step | T1 | T2 |
|---|---|---|
| 1 | `BEGIN; SELECT pg_try_advisory_xact_lock(804232);` → `t` | |
| 2 | | `BEGIN; SELECT pg_try_advisory_xact_lock(804232);` → **`f`** (skip this tick) |
| 3 | | `SELECT locktype, objid, mode, granted FROM pg_locks WHERE locktype='advisory';` |
| 4 | `COMMIT;` (lock released) | run step 3 again: no rows |

Then try the **waiting** form: T1 `BEGIN; SELECT pg_advisory_xact_lock(hashtext('assign:payments'));`, T2 the same: T2 hangs until T1 commits. That is how two simultaneous ticket creations in `payments` take turns choosing an assignee.

*You should see:*

```text
instance 1: t
instance 2: f
 locktype |   objid    |     mode      | granted
 advisory | 2753804881 | ExclusiveLock | t
```

---

## Lab 8: Stronger isolation: serialization failures and write skew

**Idea:** REPEATABLE READ aborts instead of losing an update; only SERIALIZABLE stops write skew. ([MVCC, sections 5 and 6](mvcc-and-isolation.md#5-repeatable-read-one-snapshot-per-transaction))

**8a. Serialization failure.** Both sessions:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT n FROM lab_counter WHERE id=1;
UPDATE lab_counter SET n = n + 1 WHERE id=1;   -- in T1 first, then T2 (T2 waits)
COMMIT;                                          -- T1 commits
```

*You should see* in T2:

```text
ERROR:  could not serialize access due to concurrent update
ROLLBACK
```

**8b. Write skew.** The rule: at least one person stays on call. Each session checks, then takes **itself** off.

| Step | T1 | T2 |
|---|---|---|
| 1 | `UPDATE lab_oncall SET on_call = true;` | |
| 2 | `BEGIN ISOLATION LEVEL REPEATABLE READ;` `SELECT count(*) FROM lab_oncall WHERE on_call;` → 2 | same → 2 |
| 3 | `UPDATE lab_oncall SET on_call=false WHERE name='a';` | `UPDATE lab_oncall SET on_call=false WHERE name='b';` |
| 4 | `COMMIT;` | `COMMIT;` |
| 5 | `SELECT count(*) FROM lab_oncall WHERE on_call;` | |
| 6 | Repeat with `SERIALIZABLE` | |

*You should see:*

```text
REPEATABLE READ -> still on call: 0                  ← the rule is broken, and nobody got an error
SERIALIZABLE    -> ERROR:  could not serialize access due to read/write dependencies among transactions
                -> still on call: 1
```

---

## Lab 9: Cause a deadlock on purpose

**Idea:** opposite lock order deadlocks; PostgreSQL detects it and aborts one. ([Locking, section 8](locking-and-concurrency.md#8-deadlocks))

| Step | T1 | T2 |
|---|---|---|
| 1 | `BEGIN; UPDATE lab_acct SET bal=bal-1 WHERE id=1;` | `BEGIN; UPDATE lab_acct SET bal=bal-1 WHERE id=2;` |
| 2 | `UPDATE lab_acct SET bal=bal+1 WHERE id=2;` → hangs | |
| 3 | | `UPDATE lab_acct SET bal=bal+1 WHERE id=1;` → after about 1 s, one of the two fails |

*You should see* (in whichever session was chosen as the victim):

```text
ERROR:  deadlock detected
DETAIL:  Process 194 waits for ShareLock on transaction 49587; blocked by process 195.
Process 195 waits for ShareLock on transaction 49586; blocked by process 194.
```

The other session's UPDATE completes; `COMMIT` it. Now redo the lab with **both** sessions updating id 1 first, then id 2: no deadlock, just a short wait. Consistent lock order is the cure.

---

## Lab 10: NOTIFY is delivered only on COMMIT

**Idea:** why a rolled-back change never reaches a browser. ([Notifications: live push](../notifications/live-push.md))

| Step | T1 | T2 |
|---|---|---|
| 1 | `LISTEN ticket_live;` | |
| 2 | | `BEGIN; SELECT pg_notify('ticket_live','rolled-back change'); ROLLBACK;` |
| 3 | | `BEGIN; SELECT pg_notify('ticket_live','committed change'); COMMIT;` |
| 4 | `SELECT 1;` (psql prints notifications it has received after running any command) | |

*You should see* in T1 only the committed one:

```text
Asynchronous notification "ticket_live" with payload "committed change" received from server process with PID 220.
```

---

## Lab 11: The timeouts that keep the pool healthy

**Idea:** turn unbounded waits into errors. ([Connection pool, section 3](connection-pool.md#3-the-three-timeouts-and-the-failures-they-prevent))

```sql
SET statement_timeout = '300ms';
SELECT pg_sleep(1);
RESET statement_timeout;

SET idle_in_transaction_session_timeout = '500ms';
BEGIN; SELECT 1;
\! sleep 1.5
SELECT 2;
```

(`\!` runs a shell command from psql; the session is idle inside its open transaction meanwhile.) *You should see:*

```text
ERROR:  canceling statement due to statement timeout
...
FATAL:  terminating connection due to idle-in-transaction timeout
server closed the connection unexpectedly
```

Reconnect with `\c` afterwards. The `FATAL` is the point: the stuck session, and every lock it held, is gone.

---

## Lab 12: Keyset vs OFFSET paging, measured

**Idea:** a bookmark beats counting from the front. ([Indexes, section 5](indexes-and-query-plans.md#5-measured-keyset-paging-vs-offset))

```sql
-- Find a bookmark about 8,000 rows deep in the payments queue
SELECT created_at AS c, id AS i FROM tickets WHERE legal_entity='BANK-IN' AND country='IN' AND queue='payments'
ORDER BY created_at DESC, id DESC OFFSET 8000 LIMIT 1 \gset

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT id FROM tickets WHERE legal_entity='BANK-IN' AND country='IN' AND queue='payments'
  AND (created_at, id) < (:'c'::timestamptz, :'i'::uuid) ORDER BY created_at DESC, id DESC LIMIT 51;

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT id FROM tickets WHERE legal_entity='BANK-IN' AND country='IN' AND queue='payments'
ORDER BY created_at DESC, id DESC OFFSET 8000 LIMIT 51;
```

*You should see:* the keyset plan reads `actual rows=51` with `Buffers: shared hit=4`; the OFFSET plan reads `actual rows=8051` with `shared hit=71`. Then try `queue = ANY(ARRAY['payments','cards'])` without a cursor and find the `Sort` node with `top-N heapsort` over 16,668 rows.

---

## Lab 13: Find foreign keys without an index

**Idea:** PostgreSQL does not index referencing columns for you. ([Constraints, section 4](constraints-and-integrity.md#postgresql-does-not-index-foreign-key-columns-for-you))

```sql
SELECT c.conrelid::regclass AS child_table, a.attname AS fk_column, c.confrelid::regclass AS parent,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) AS has_leading_index
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f' ORDER BY has_leading_index, 1;
```

*You should see* 15 rows with `has_leading_index = f` at the top, including `ticket_references | ticket_id | tickets`. Now measure it:

```sql
SELECT id AS t FROM tickets ORDER BY created_at LIMIT 1 \gset
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT * FROM ticket_references WHERE ticket_id = :'t';
CREATE INDEX lab_ref_ticket ON ticket_references (ticket_id);
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT * FROM ticket_references WHERE ticket_id = :'t';
DROP INDEX lab_ref_ticket;
```

*You should see:* `Seq Scan ... Rows Removed by Filter: 99998`, about 6 ms; then `Index Scan using lab_ref_ticket`, about 0.09 ms.

---

## Lab 14: The notification inbox query plan

**Idea:** a `BitmapOr` combines two indexes for the audience `OR`. The full set of notification labs is in [Notifications: hands-on labs](../notifications/hands-on-labs.md).

```sql
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT n.id, n.title, n.created_at, r.read_at
FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = 'agent-2'
WHERE (n.recipient_user = 'agent-2'
       OR (n.recipient_queue = ANY(ARRAY['payments']) AND n.audience_role = ANY(ARRAY['supervisor','agent'])
           AND n.legal_entity = 'BANK-IN' AND n.country = 'IN'))
ORDER BY n.created_at DESC LIMIT 50;
```

*You should see* a `BitmapOr` over `notifications_recipient_user_created_at_index` (2,000 rows) and `notifications_recipient_queue_audience_role_created_at_index` (3,334 rows), then a `top-N heapsort` keeping 50 of 5,334.

---

## Lab 15: Aborted transactions and savepoints

**Idea:** after an error, a transaction refuses everything until rollback, unless you use a savepoint. ([Transactions, section 5](transactions.md#5-errors-inside-a-transaction-the-aborted-state))

```sql
BEGIN;
INSERT INTO ticket_escalations (id,ticket_id,rule_key,trigger,from_queue,to_queue)
  SELECT gen_random_uuid(), ticket_id, 'r1', 'breached', 'a', 'b' FROM ticket_escalations LIMIT 1;  -- duplicate (from lab 3)
SELECT 1;
ROLLBACK;

BEGIN;
SAVEPOINT try_insert;
INSERT INTO ticket_escalations (id,ticket_id,rule_key,trigger,from_queue,to_queue)
  SELECT gen_random_uuid(), ticket_id, 'r1', 'breached', 'a', 'b' FROM ticket_escalations LIMIT 1;
ROLLBACK TO SAVEPOINT try_insert;
SELECT 'still usable' AS after_savepoint;
COMMIT;

SHOW max_connections;
SHOW default_transaction_isolation;
```

*You should see:*

```text
ERROR:  duplicate key value violates unique constraint "ticket_escalations_ticket_rule_uq"
ERROR:  current transaction is aborted, commands ignored until end of transaction block
ROLLBACK
...
ROLLBACK
 after_savepoint
 still usable
COMMIT
 max_connections
 100
 default_transaction_isolation
 read committed
```

---

## Lab 16: Least-privilege roles

**Idea:** the app account can append audit events but never change them. ([Migrations and roles, section 5](migrations-and-roles.md#5-roles-owner-app-reporting))

Roles belong to the whole PostgreSQL server, not one database, so this lab uses **renamed** roles (`lab_owner`, `lab_app`, `lab_reporting`) to avoid touching any real ones.

```bash
sed -e 's/case_owner/lab_owner/g; s/case_app/lab_app/g; s/case_reporting/lab_reporting/g' \
    -e 's/${OWNER_PASSWORD}/owner_pw/; s/${APP_PASSWORD}/app_pw/; s/${REPORTING_PASSWORD}/rep_pw/' \
    infra/postgres/roles.sql > /tmp/roles-lab.sql
psql -q -v ON_ERROR_STOP=1 -f /tmp/roles-lab.sql

PGUSER=lab_app PGPASSWORD=app_pw psql <<'SQL'
INSERT INTO audit_events (id,actor_id,action,target_type,target_id,correlation_id,outcome,event_hash)
  VALUES (gen_random_uuid(),'lab','x','ticket','t','c','success','h');
UPDATE audit_events SET outcome='denied';
TRUNCATE audit_events;
ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
UPDATE tickets SET priority='high' WHERE id=(SELECT id FROM tickets LIMIT 1);
SQL

PGUSER=lab_reporting PGPASSWORD=rep_pw psql -c "SELECT count(*) FROM reporting.tickets" -c "SELECT subject FROM tickets LIMIT 1"
```

*You should see:*

```text
INSERT 0 1
ERROR:  permission denied for table audit_events
ERROR:  permission denied for table audit_events
ERROR:  must be owner of table audit_events
UPDATE 1
 count
 50000
ERROR:  permission denied for table tickets
```

---

## Clean up

```bash
psql -d postgres -c "DROP DATABASE IF EXISTS case_lab"
psql -d postgres -c "DROP ROLE IF EXISTS lab_app" -c "DROP ROLE IF EXISTS lab_reporting" -c "DROP ROLE IF EXISTS lab_owner"
```

(Drop the database first: a role that still owns objects or holds privileges somewhere cannot be dropped.) Your development database `case_platform` was never touched.

Next: [Interview Q&A](interview-qa.md)
