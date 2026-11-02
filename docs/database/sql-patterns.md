# SQL patterns cookbook

[Back to Database index](README.md) · Previous: [Indexes and query plans](indexes-and-query-plans.md) · Next: [Transactions and ACID](transactions.md)

The services are written in plain SQL through the `pg` driver, with no ORM (object-relational mapper, a library that generates SQL from objects). That makes the SQL visible, which means you can learn a lot of real-world PostgreSQL by reading it. This page collects every idiom the code uses: what it does, why it was chosen, and the line where it appears.

---

## 1. Parameterised queries: the SQL injection defence

Every value travels as a **parameter** (`$1`, `$2`, ...), never pasted into the SQL text:

```ts
await client.query('SELECT * FROM tickets WHERE id=$1', [ticketId]);   // tickets.service.ts#L380
```

**SQL injection** is an attack where input is concatenated into SQL and changes its meaning. If the code built `"... WHERE id='" + ticketId + "'"` and someone sent `' OR '1'='1`, the query would return every ticket. With parameters, the driver sends the SQL text and the values **separately** using PostgreSQL's extended query protocol. The server parses the SQL first, then binds the values as data. A value can never become code, whatever characters it contains.

There are a handful of places where SQL text *is* built with `${...}`. Each is a fixed string chosen by code, never input, and each has a comment saying so:

| Fragment | Why it cannot be a parameter | Where |
|---|---|---|
| `NEXT_SLA_STATUS_SQL` (a `CASE` expression) | Parameters hold values, not expressions | [sla.service.ts#L17](../../apps/api/src/tickets/sla.service.ts#L17) |
| Escalation `TRIGGER_SQL[rule.trigger]` | Same; the key is validated by a CHECK on the rules table | [escalation.service.ts#L12-L18](../../apps/api/src/workflow/escalation.service.ts#L12-L18) |
| Assignment `ORDER BY` | `ORDER BY` columns cannot be parameters | [assignment.service.ts#L27-L28](../../apps/api/src/tickets/assignment.service.ts#L27-L28) |
| `AuditService.previous(table, where)` | Table names cannot be parameters | [audit.service.ts#L32-L37](../../apps/api/src/audit/audit.service.ts#L32-L37) |
| `LISTEN ticket_live` | `LISTEN` takes an identifier, not a value | [live-events.service.ts#L91](../../apps/api/src/live/live-events.service.ts#L91) |
| `LIMIT ${BATCH}` in retention/escalation | A numeric constant in code | [retention.service.ts#L29](../../apps/api/src/retention/retention.service.ts#L29) |

**The rule:** values are always parameters. Identifiers and SQL fragments may only come from a fixed list in code. If one ever had to come from input, you would validate it against an allow-list first (or use `format('%I', ...)` in SQL, as [roles.sql#L24](../../infra/postgres/roles.sql#L24) does).

---

## 2. `RETURNING`: get the row you just changed

```sql
UPDATE tickets SET priority=COALESCE($1,priority), ... WHERE id=$4 RETURNING *     -- tickets.service.ts#L123
```

`RETURNING` makes an `INSERT`, `UPDATE` or `DELETE` return the affected rows, as a `SELECT` would. It saves a second query, and more importantly it returns the row **exactly as this statement left it**, with no chance of another transaction's change sneaking in between an update and a re-read. The ticket services use `RETURNING *` to get the post-update row for the audit summary, the live event and the HTTP response.

`result.rowCount` (how many rows were affected) is equally useful: zero rows means "nothing matched", which several patterns below rely on.

---

## 3. `ANY($1::text[])`: a list as one parameter

```sql
WHERE legal_entity=$1 AND country=$2 AND queue = ANY($3::text[])                  -- tickets.service.ts#L78
```

A user holds several queues. Rather than building `queue IN ($3, $4, $5, ...)` with a variable number of placeholders, the code passes the whole JavaScript array as **one** parameter. The `pg` driver sends it as a PostgreSQL array, and `= ANY(array)` means "equals any element". The SQL text is identical however many queues the user has, which keeps it simple, safe, and lets PostgreSQL reuse the plan.

The `::text[]` is a **cast** (a type conversion). It tells the server the parameter's type up front; without it PostgreSQL sometimes cannot infer the type of a bare parameter and refuses the query.

The same idea appears in reverse in `markRead`: `n.id = ANY($7::uuid[])` checks "is this one of the IDs the user clicked?" ([notifications.service.ts#L46](../../apps/api/src/notifications/notifications.service.ts#L46)).

---

## 4. Optional filters: `($4::type IS NULL OR ...)`

```sql
AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))   -- tickets.service.ts#L79
```

The first page has no cursor; later pages do. Instead of two SQL strings, the code passes NULL for "no cursor" and the condition switches itself off. The cast is required here because PostgreSQL must know `$4`'s type even when it is NULL.

Other examples: `($1::text IS NULL OR event_type=$1)` for an optional event-type filter in outbox replay ([outbox-admin.service.ts#L35](../../apps/api/src/operations/outbox-admin.service.ts#L35)), and `($6::boolean OR n.id = ANY($7::uuid[]))` for "mark all" vs "mark these" ([notifications.service.ts#L46](../../apps/api/src/notifications/notifications.service.ts#L46)).

A caution: this style can stop PostgreSQL from choosing the best index for each case, because one plan must serve both. Here it is fine; measured plans still use the paging index ([indexes](indexes-and-query-plans.md#5-measured-keyset-paging-vs-offset)).

---

## 5. Row-value comparison: `(a, b) < (x, y)`

```sql
(created_at, id) < ($4::timestamptz, $5::uuid)
```

This compares **pairs** lexicographically, like words in a dictionary: true if `created_at < x`, or if `created_at = x AND id < y`. It is exactly the keyset bookmark condition "everything after this row, in newest-first order". Writing it out by hand (`created_at < $4 OR (created_at = $4 AND id < $5)`) is equivalent but harder to read, and PostgreSQL turns the row form directly into an index range ([measured](indexes-and-query-plans.md#5-measured-keyset-paging-vs-offset)).

---

## 6. Upsert: `INSERT ... ON CONFLICT (...) DO UPDATE`

```sql
INSERT INTO ticket_retention_controls (ticket_id,retention_until,legal_hold,hold_reason,updated_by)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (ticket_id) DO UPDATE SET retention_until=EXCLUDED.retention_until, legal_hold=EXCLUDED.legal_hold,
  hold_reason=EXCLUDED.hold_reason, updated_by=EXCLUDED.updated_by, updated_at=now()
RETURNING ...                                                                      -- tickets.service.ts#L109-L112
```

An **upsert** means "insert, or update if it already exists". `ON CONFLICT (ticket_id)` names the unique key that defines "already exists". `EXCLUDED` is a pseudo-row holding the values you tried to insert. The whole thing is **atomic**: there is no gap between "check" and "insert" for another transaction to slip into. Two concurrent upserts for the same ticket serialise on the unique index, and both succeed, one after the other.

The tempting alternative ("SELECT, then INSERT or UPDATE in code") has exactly that gap, and under concurrency one of the requests gets a unique violation.

---

## 7. Claim once: `INSERT ... ON CONFLICT DO NOTHING RETURNING`

```sql
INSERT INTO ticket_escalations (id,ticket_id,rule_key,...) VALUES (...)
ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id                         -- escalation.service.ts#L50
```

`DO NOTHING` silently skips the insert if the key exists. With `RETURNING`, the result tells you who won: **one row back** means "I inserted it, I own this escalation"; **zero rows** means "someone already did it, stop". The very next line is `if (!claimed.rowCount) return false;`. This is the cleanest way to get "exactly once" behaviour across several scheduler instances. [Lab 3](hands-on-labs.md#lab-3-constraints-refuse-bad-data) shows the first claim returning `t` and the second returning zero rows.

---

## 8. `INSERT ... SELECT`: insert the result of a query

```sql
INSERT INTO notification_reads (notification_id,user_id)
SELECT n.id, $1 FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1
WHERE r.read_at IS NULL AND <audience> AND ($6::boolean OR n.id = ANY($7::uuid[]))
ON CONFLICT DO NOTHING                                                            -- notifications.service.ts#L46
```

Instead of loading rows into the API and inserting them one by one, the database inserts whatever the `SELECT` returns, in one statement. Besides speed, it is a security property: the `SELECT` includes the audience filter, so a user can only create read markers for notifications **they are allowed to see**. Sending someone else's notification ID simply matches nothing. More in [Notifications: data model and SQL](../notifications/data-model-and-sql.md#4-marking-read-insert--select-with-the-audience-filter).

---

## 9. LEFT JOIN with the filter in `ON`, and the anti-join

```sql
FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1
WHERE r.read_at IS NULL AND ...                                                   -- notifications.service.ts#L41
```

Two lessons in one line.

**A LEFT JOIN keeps every left row**, filling the right side with NULLs when nothing matches. Here: every notification, plus *my* read marker if I have one.

**Where you put a condition matters.** `r.user_id=$1` is in the `ON` clause, so it limits *which read markers are joined* (only mine). If it were in the `WHERE` clause instead, notifications with no read marker at all (where `r.user_id` is NULL) would be thrown away, silently turning the LEFT JOIN into an inner join and hiding every unread notification. This is one of the most common SQL bugs.

**`WHERE r.read_at IS NULL` after a LEFT JOIN is an anti-join**: "rows with no match on the right". Here, notifications I have not read. `read_at` is `NOT NULL` in the table, so it can only be NULL when the join found nothing.

---

## 10. `NOT EXISTS`: the other anti-join

```sql
SELECT t.id FROM tickets t, case_queues target
WHERE ... AND NOT EXISTS (SELECT 1 FROM ticket_escalations e WHERE e.ticket_id=t.id AND e.rule_key=$3)  -- escalation.service.ts#L36-L39
```

"Tickets that have not yet been escalated by this rule." `NOT EXISTS` is often clearer than the LEFT JOIN form when you do not need any columns from the other table, and PostgreSQL plans both as an anti-join. Note the candidate query is only a *hint*: the authoritative "has this happened?" is the claim in pattern 7, re-checked under a row lock, because a candidate can become stale between the query and the action.

---

## 11. Claim a batch: CTE + `FOR UPDATE SKIP LOCKED` + `UPDATE ... FROM`

```sql
WITH candidates AS (
  SELECT id FROM integration_outbox
  WHERE status IN ('pending','retry') AND next_attempt_at <= now()
  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
)
UPDATE integration_outbox AS o SET status='in_flight', claimed_at=now(), attempts=o.attempts+1
FROM candidates WHERE o.id=candidates.id
RETURNING o.id, o.event_type, ...                                                 -- outbox.service.ts#L35
```

This one statement is a complete, concurrency-safe **work queue claim**:

1. The **CTE** (common table expression, the `WITH ... AS (...)` block, a named sub-query) picks up to N due events, oldest first.
2. `FOR UPDATE` locks them; `SKIP LOCKED` skips rows another dispatcher has already locked instead of waiting.
3. `UPDATE ... FROM candidates` marks exactly those rows `in_flight` and counts the attempt.
4. `RETURNING` hands the claimed rows back.

Two dispatchers running this at the same moment get **disjoint** batches. [Lab 6](hands-on-labs.md#lab-6-skip-locked-two-workers-never-take-the-same-row) shows worker A taking `t1,t2,t3` and worker B taking `t4,t5,t6`. [Locking](locking-and-concurrency.md#3-for-update-skip-locked-the-work-queue) explains the mechanics.

A variant without a CTE uses `WHERE id IN (subquery FOR UPDATE SKIP LOCKED)` ([sla.service.ts#L85-L87](../../apps/api/src/tickets/sla.service.ts#L85-L87), [outbox-admin.service.ts#L35](../../apps/api/src/operations/outbox-admin.service.ts#L35)).

---

## 12. `UPDATE ... FROM`: update using another table

```sql
UPDATE tickets t SET regulatory_status=<expression using p>, updated_at=now()
FROM regulatory_profiles p
WHERE p.profile_key=t.regulatory_profile AND t.id IN (... FOR UPDATE OF t2 SKIP LOCKED)
RETURNING t.*                                                                     -- compliance.service.ts#L94-L100
```

`UPDATE ... FROM` joins the target table with others so the new value can depend on them (here, each ticket's regulatory profile defines its deadlines). `FOR UPDATE OF t2` locks only the ticket rows, not the profile rows, which would otherwise be locked by every reconciliation and contend needlessly. The same `OF` refinement appears in retention (`FOR UPDATE OF t`, [retention.service.ts#L41](../../apps/api/src/retention/retention.service.ts#L41)) and delivery (`FOR UPDATE OF c`, [delivery.worker.ts#L47](../../apps/api/src/email/delivery.worker.ts#L47)).

---

## 13. `CASE` inside `SET`: several rules in one update

```sql
UPDATE tickets SET status=$1::text, updated_at=now(),
  first_responded_at = CASE WHEN $1::text IN ('pending_customer','resolved') THEN COALESCE(first_responded_at, now()) ELSE first_responded_at END,
  resolved_at        = CASE WHEN $1::text='resolved' THEN now() WHEN $1::text='reopened' THEN NULL ELSE resolved_at END,
  closed_at          = CASE WHEN $1::text IN ('closed','cancelled') THEN now() WHEN $1::text='reopened' THEN NULL ELSE closed_at END
WHERE id=$2 RETURNING *                                                           -- tickets.service.ts#L183-L189
```

A status change has knock-on effects on several timestamp columns. Expressing them as `CASE` expressions keeps the whole state change in **one atomic statement**, rather than several updates or read-then-compute-in-code. `ELSE column` means "leave it as it is".

---

## 14. `COALESCE` for "set once"

```sql
UPDATE tickets SET first_responded_at=COALESCE(first_responded_at, now()) WHERE id=$1   -- tickets.service.ts#L160
```

`COALESCE(a, b)` returns the first non-NULL argument. Here: keep the existing first-response time if there is one, otherwise stamp now. The first response is recorded once and never overwritten by later responses, and because the decision happens inside the `UPDATE`, two simultaneous first responses cannot both "win".

---

## 15. `IS DISTINCT FROM`: NULL-safe comparison, and skipping no-op writes

```sql
UPDATE tickets SET sla_status=<next status>, updated_at=now()
WHERE ... AND sla_status IS DISTINCT FROM <next status>                           -- sla.service.ts#L85-L86
```

`a <> b` is NULL (not true) when either side is NULL. `a IS DISTINCT FROM b` treats NULL as an ordinary value: `NULL IS DISTINCT FROM 'running'` is true, `NULL IS DISTINCT FROM NULL` is false.

Why the condition at all? The SLA job runs every minute over all open tickets. Without the condition it would rewrite every row each time. In PostgreSQL **every UPDATE writes a new row version** ([MVCC](mvcc-and-isolation.md)), even if nothing changed, so that would create thousands of dead rows a minute, fire audit events for non-changes, and bump `updated_at` (which would also break users' optimistic-concurrency tokens). Updating only rows whose status actually changes avoids all three.

---

## 16. Conditional update: change it only if it is still as expected

```sql
UPDATE integration_outbox SET status='published', published_at=now(), claimed_at=NULL
WHERE id=$1 AND status='in_flight'                                                -- outbox.service.ts#L39
```

The extra `AND status='in_flight'` means "only if nobody has changed it since I claimed it". If a stale-claim sweep has already reset the row to `retry`, this update matches zero rows and does no harm. It is **optimistic concurrency** in one line: the `WHERE` clause states your assumption, and PostgreSQL re-checks it on the latest row version at write time ([locking](locking-and-concurrency.md#5-conditional-update-optimistic-concurrency)).

---

## 17. Time arithmetic with intervals

```sql
next_attempt_at = now() + ($1 * interval '1 second')                              -- delivery.worker.ts#L48
COALESCE(rc.retention_until, t.closed_at + (c.retention_years * interval '1 year')) <= now()   -- retention.service.ts#L28
first_response_due_at = first_response_due_at + (now() - sla_paused_at)          -- customer-reply.service.ts#L32
```

An `interval` is a duration. Multiplying a parameter by `interval '1 second'` turns a plain number into a duration safely, without building a string like `'120 seconds'`. Subtracting two timestamps gives an interval (how long the SLA was paused), which can be added to another timestamp (push the deadline back by the pause).

---

## 18. Smaller idioms worth recognising

| Idiom | Meaning | Where |
|---|---|---|
| `count(*)::text AS n` then `Number(...)` | `count(*)` is `bigint`; the driver returns bigints as strings to avoid losing precision in JavaScript numbers | [notifications.service.ts#L41-L42](../../apps/api/src/notifications/notifications.service.ts#L41-L42) |
| `ORDER BY (category IS NOT NULL) DESC, (priority IS NOT NULL) DESC, sort_order` | Sort by booleans to make the **most specific** matching rule win | [assignment.service.ts#L24-L25](../../apps/api/src/tickets/assignment.service.ts#L24-L25) |
| `(category IS NULL OR category=$2)` | A NULL rule field means "matches anything" | same |
| Correlated subquery in `SELECT` | `(SELECT count(*) FROM tickets t WHERE t.assigned_to=m.user_id ...) AS open_count` computed per member | [assignment.service.ts#L30](../../apps/api/src/tickets/assignment.service.ts#L30) |
| `JSON.stringify(obj)` as a parameter into a `jsonb` column | The driver sends text; PostgreSQL parses it as JSON | [tickets.service.ts#L47](../../apps/api/src/tickets/tickets.service.ts#L47) |
| `ILIKE $4 ESCAPE '\\'` | Case-insensitive pattern match where `\` escapes `%` and `_` | [tickets.service.ts#L92](../../apps/api/src/tickets/tickets.service.ts#L92) |
| `SELECT pg_notify($1, $2)` | Send a NOTIFY with parameters (the `NOTIFY` command itself cannot take parameters) | [live-events.service.ts#L47](../../apps/api/src/live/live-events.service.ts#L47) |
| `LIMIT $1` with `Math.min(Math.max(n, 1), 100)` in code | Clamp batch and page sizes so a caller cannot request a million rows | [outbox.service.ts#L35](../../apps/api/src/outbox/outbox.service.ts#L35), [notifications.service.ts#L35](../../apps/api/src/notifications/notifications.service.ts#L35) |

Next: [Transactions and ACID](transactions.md)
