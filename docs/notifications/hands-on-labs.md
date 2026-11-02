# Notifications: hands-on labs

[Back to Notifications index](README.md) · Previous: [Performance and limits](performance-and-limits.md) · Next: [Interview Q&A](interview-qa.md)

Eight experiments that prove every rule of the feature on a scratch database, using **the same SQL the service runs**. The "you should see" outputs are real, captured on the project's PostgreSQL 16 container.

**Setup.** Follow [Database labs: setup](../database/hands-on-labs.md#setup-a-scratch-copy-of-our-schema) to create and seed `case_lab`, then in your terminal:

```bash
export PGHOST=localhost PGPORT=5433 PGUSER=case_user PGPASSWORD=case_password PGDATABASE=case_lab
psql
```

The seed already holds 20,000 "Lab notification ..." rows for the performance labs. The labs below create their own rows with users and queues prefixed `nlab-`, and filter the seed rows out so the results stay readable.

---

## Become a user: the inbox query with psql variables

The service takes five values from the user's token. In psql, set them as **variables**, then run the service's audience SQL with `:'name'` (psql substitutes the value as a quoted literal). Paste this once; it defines a query you can re-run with `:inbox` after changing who you are.

```sql
\set inbox 'SELECT n.type, n.title, (r.read_at IS NOT NULL) AS read FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :''me'' WHERE n.title NOT LIKE ''Lab notification%'' AND (n.recipient_user = :''me'' OR (n.recipient_queue = ANY(:''queues''::text[]) AND n.audience_role = ANY(:''roles''::text[]) AND n.legal_entity = :''entity'' AND n.country = :''country'')) ORDER BY n.created_at DESC;'
\set markall 'INSERT INTO notification_reads (notification_id, user_id) SELECT n.id, :''me'' FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :''me'' WHERE r.read_at IS NULL AND n.title NOT LIKE ''Lab notification%'' AND (n.recipient_user = :''me'' OR (n.recipient_queue = ANY(:''queues''::text[]) AND n.audience_role = ANY(:''roles''::text[]) AND n.legal_entity = :''entity'' AND n.country = :''country'')) ON CONFLICT DO NOTHING;'
```

(Inside a `\set` value, `''` is one literal quote, so `:''me''` becomes `:'me'` when the query runs.)

---

## Lab 1: The two shapes, and the CHECK

**Idea:** a notification targets a person **or** a role in a queue, and the database refuses one with no audience. ([Data model](data-model-and-sql.md#the-audience-check))

```sql
INSERT INTO notifications (id, recipient_user, recipient_queue, audience_role, legal_entity, country, type, ticket_id, title) VALUES
  (gen_random_uuid(), 'nlab-agent', NULL, NULL, 'BANK-IN', 'IN', 'ticket_assigned', NULL, 'A ticket was assigned to you'),
  (gen_random_uuid(), NULL, 'nlab-payments', 'supervisor', 'BANK-IN', 'IN', 'approval_needed', NULL, 'An approval is waiting for a decision');

INSERT INTO notifications (id, recipient_queue, legal_entity, country, type, title)
  VALUES (gen_random_uuid(), 'nlab-payments', 'BANK-IN', 'IN', 'ticket_assigned', 'queue but no role');
```

*You should see:*

```text
INSERT 0 2
ERROR:  new row for relation "notifications" violates check constraint "notifications_target_chk"
```

The second insert has a queue but no role, so nobody could ever match it, and the database refuses it.

---

## Lab 2: Who sees what

**Idea:** the audience predicate, evaluated from token claims. ([Data model, section 2](data-model-and-sql.md#2-the-audience-predicate))

```sql
\set me nlab-agent
\set queues '{nlab-payments}'
\set roles '{case-agent}'
\set entity BANK-IN
\set country IN
:inbox

\set me nlab-sup1
\set roles '{supervisor}'
:inbox

\set me nlab-sup-au
\set entity BANK-AU
\set country AU
:inbox
```

*You should see* three results, one per user:

```text
      type       |            title             | read          ← nlab-agent
 ticket_assigned | A ticket was assigned to you | f
(1 row)
      type       |                 title                 | read ← nlab-sup1
 approval_needed | An approval is waiting for a decision | f
(1 row)
 type | title | read                                           ← nlab-sup-au
(0 rows)
```

The agent sees only their personal notification: they hold the queue but not the `supervisor` role. The supervisor sees the queue notification. A supervisor of a queue **with the same name** in another legal entity sees nothing, because queue audiences also match entity and country.

---

## Lab 3: Read state is per person

**Idea:** one supervisor reading does not clear it for another. ([Data model, section 4](data-model-and-sql.md#4-marking-read-insert--select-with-the-audience-filter))

```sql
\set me nlab-sup1
\set entity BANK-IN
\set country IN
:markall
:inbox

\set me nlab-sup2
:inbox

\set me nlab-sup1
:markall
```

*You should see:*

```text
INSERT 0 1                                                          ← sup1 marks all read
      type       |                 title                 | read
 approval_needed | An approval is waiting for a decision | t        ← read, for sup1
      type       |                 title                 | read
 approval_needed | An approval is waiting for a decision | f        ← still unread, for sup2
INSERT 0 0                                                          ← sup1 again: nothing to do (idempotent)
```

This is the same property the integration test checks ([workflow.integration-spec.ts#L242-L244](../../apps/api/test/workflow.integration-spec.ts#L242-L244)).

---

## Lab 4: You cannot mark someone else's notification

**Idea:** the audience filter inside the `INSERT ... SELECT` is a security control. Here `nlab-sup2` sends the **agent's** personal notification ID, as a malicious client could.

```sql
SELECT id AS victim FROM notifications WHERE recipient_user = 'nlab-agent' \gset
\set me nlab-sup2
INSERT INTO notification_reads (notification_id, user_id)
SELECT n.id, :'me' FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :'me'
WHERE r.read_at IS NULL
  AND (n.recipient_user = :'me' OR (n.recipient_queue = ANY(:'queues'::text[]) AND n.audience_role = ANY(:'roles'::text[]) AND n.legal_entity = :'entity' AND n.country = :'country'))
  AND (false OR n.id = ANY(ARRAY[:'victim']::uuid[]))
ON CONFLICT DO NOTHING;
```

(`false OR ...` is the service's `$6::boolean` "mark all" flag set to false.) *You should see:*

```text
INSERT 0 0
```

The ID was valid, but it does not match `nlab-sup2`'s audience, so nothing was inserted. Even if it had been, the marker would carry `nlab-sup2`'s subject and so could never affect the agent's inbox.

---

## Lab 5: Membership is evaluated at read time

**Idea:** no fan-out rows to clean up; leaving a queue removes its notifications immediately. ([Concepts](concepts.md#2-targeting-and-fan-out))

```sql
\set me nlab-sup1
\set queues '{nlab-cards}'
:inbox
```

*You should see:*

```text
(0 rows)
```

`nlab-sup1`'s "token" no longer lists `nlab-payments`, so the queue notification is no longer theirs. The row was not touched. Set `queues` back to `'{nlab-payments}'` and it reappears (already read, from lab 3).

---

## Lab 6: The cost of "Mark all read" for a busy queue

**Idea:** with fan-out on read, marking all read writes one row per notification. ([Performance, section 2](performance-and-limits.md#2-how-read-state-grows))

```sql
BEGIN;
INSERT INTO notification_reads (notification_id, user_id)
SELECT n.id, 'busy-sup' FROM notifications n
WHERE n.recipient_queue = 'payments' AND n.audience_role = 'supervisor'
ON CONFLICT DO NOTHING;
ROLLBACK;            -- keep the lab data unchanged
```

*You should see:*

```text
INSERT 0 3334
```

One click, 3,334 rows. Multiply by every supervisor and every month to see why the read table grows fastest.

---

## Lab 7: The inbox plan, and the missing index

**Idea:** measure the inbox before and after read state grows, and the fix. ([Performance, section 3](performance-and-limits.md#3-what-that-growth-does-to-the-queries))

```sql
-- Grow read state: 100 users mark the payments queue's notifications read, plus every person notification is read by its recipient
INSERT INTO notification_reads (notification_id, user_id)
  SELECT n.id, 'agent-' || u FROM notifications n, generate_series(0, 99) u WHERE n.recipient_queue = 'payments' ON CONFLICT DO NOTHING;
INSERT INTO notification_reads (notification_id, user_id)
  SELECT n.id, n.recipient_user FROM notifications n WHERE n.recipient_user IS NOT NULL ON CONFLICT DO NOTHING;
ANALYZE notification_reads;

\set q 'EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ''agent-2'' WHERE r.read_at IS NULL AND (n.recipient_user = ''agent-2'' OR (n.recipient_queue = ANY(ARRAY[''payments'']) AND n.audience_role = ANY(ARRAY[''supervisor'']) AND n.legal_entity = ''BANK-IN'' AND n.country = ''IN''));'
:q
CREATE INDEX lab_reads_user_idx ON notification_reads (user_id, notification_id);
ANALYZE notification_reads;
:q
DROP INDEX lab_reads_user_idx;
```

*You should see* (abridged; times vary between runs, 11 to 16 ms before and about 3 ms after on a laptop):

```text
               ->  Parallel Seq Scan on notification_reads r (actual rows=2667 loops=2)
                     Rows Removed by Filter: 169033
 Execution Time: 14.220 ms
...
               ->  Bitmap Index Scan on lab_reads_user_idx (actual rows=5334 loops=1)
                     Index Cond: ((user_id)::text = 'agent-2'::text)
 Execution Time: 3.687 ms
```

---

## Lab 8: NOTIFY is delivered on commit, and duplicates collapse

**Idea:** the push hint never announces a rolled-back notification, and identical hints in one transaction arrive once. ([Live push, stage 2](live-push.md#stage-2-postgresql-notify-semantics-you-must-know)) This lab needs **two terminals**.

| Step | T1 (an API instance's listener) | T2 (a producer's transaction) |
|---|---|---|
| 1 | `LISTEN ticket_live;` | |
| 2 | | `BEGIN; SELECT pg_notify('ticket_live', '{"kind":"person","user":"nlab-agent","legalEntity":"BANK-IN","country":"IN"}'); ROLLBACK;` |
| 3 | | `BEGIN;` then the same `pg_notify` **twice**, then `SELECT pg_notify('ticket_live', '{"kind":"person","queue":"nlab-payments","role":"supervisor","legalEntity":"BANK-IN","country":"IN"}');` then `COMMIT;` |
| 4 | `SELECT 1;` (psql prints received notifications after any command) | |

*You should see* in T1 exactly two notifications, both from step 3:

```text
Asynchronous notification "ticket_live" with payload "{"kind":"person","user":"nlab-agent","legalEntity":"BANK-IN","country":"IN"}" received from server process with PID 2565.
Asynchronous notification "ticket_live" with payload "{"kind":"person","queue":"nlab-payments","role":"supervisor","legalEntity":"BANK-IN","country":"IN"}" received from server process with PID 2565.
```

Nothing from the rolled-back step 2, and the duplicated person payload arrived once. Those payloads are byte-for-byte what `notifyPerson` sends ([live-events.service.ts#L51-L54](../../apps/api/src/live/live-events.service.ts#L51-L54)).

---

## Bonus: watch the real thing in the browser

With the full stack running (`docker compose --profile app up -d --build`), open the console as an agent, open the browser's developer tools, **Network** tab, and select the `stream` request (type `eventsource` or `fetch`). In a second browser profile, sign in as a supervisor and assign a ticket to that agent. In the first window you will see a frame `event: notification` with `data: {}` arrive, immediately followed by a new `GET /v1/notifications` request, and the bell badge increments.

## Clean up

```sql
DELETE FROM notifications WHERE recipient_user LIKE 'nlab-%' OR recipient_queue LIKE 'nlab-%';
```

(Read markers go with them through `ON DELETE CASCADE`.) Or drop the whole scratch database as described in [Database labs: clean up](../database/hands-on-labs.md#clean-up).

Next: [Interview Q&A](interview-qa.md)
