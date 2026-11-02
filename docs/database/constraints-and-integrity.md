# Constraints and integrity: the database as the last line of defence

[Back to Database index](README.md) · Previous: [Schema tour](schema-tour.md) · Next: [Indexes and query plans](indexes-and-query-plans.md)

**Data integrity** means the data is correct and consistent: no note points at a missing ticket, no notification has nobody to go to, no audit event has been quietly edited. This page explains how the schema *itself* enforces integrity, why that is different from validating in code, and where we deliberately leave rules to the application.

---

## 1. Why put rules in the database at all?

The API already validates input with DTOs (`class-validator`) and checks business rules in services. Why repeat rules in the schema?

Because validation in code only protects **the code paths that remember to run it**. Over a product's life, data is written by many paths: the API, background workers, migrations that backfill data, a support engineer in `psql` during an incident, a future reporting service in another language. A constraint is checked by PostgreSQL on **every** write, from every path, inside the same transaction as the write. It cannot be forgotten.

Think of layers in a building's fire safety. Code validation is the "no smoking" sign: it works when people read it. A constraint is the sprinkler: it works whether anyone reads anything.

There is a second, subtler reason: **concurrency**. "Check in code, then insert" is a race. Two requests can both check "no duplicate yet", both pass, and both insert. A unique constraint is checked atomically by the database, so exactly one insert wins no matter how the requests interleave. This is the foundation of idempotency in this codebase ([locking and concurrency, section 6](locking-and-concurrency.md#6-unique-constraint-as-a-claim)).

What happens when a constraint is violated? The statement fails with an error carrying a **SQLSTATE code** (a five-character error category), the transaction enters the aborted state, and the `transaction()` helper rolls everything back ([transactions](transactions.md#5-errors-inside-a-transaction-the-aborted-state)). The codes you will meet:

| SQLSTATE | Name | Raised by |
|---|---|---|
| `23502` | `not_null_violation` | a NULL in a NOT NULL column |
| `23503` | `foreign_key_violation` | pointing at a missing parent, or deleting a referenced parent |
| `23505` | `unique_violation` | a duplicate primary key or unique value |
| `23514` | `check_violation` | a CHECK expression evaluated to false |
| `P0001` | `raise_exception` | our trigger's `RAISE EXCEPTION` |

---

## 2. NOT NULL and defaults

`NOT NULL` is the simplest and most valuable constraint. It turns "this might be missing" into "this is always present", which removes a whole category of bugs from every reader. Almost every column in the schema is `NOT NULL` ([data types and modelling](data-types-and-modelling.md#1-what-a-table-really-is)).

When a later migration adds a NOT NULL column to a table that already has rows, it must supply a **default**, or the migration fails because existing rows would be NULL. That is why columns added later look like `source_channel varchar(20) NOT NULL DEFAULT 'staff'` ([migration 16000#L3](../../apps/api/migrations/1710000016000_intake_channels.cjs#L3)): every existing ticket becomes a "staff" ticket, which was true. Since PostgreSQL 11, adding a column with a constant default is instant even on a huge table, because the default is stored in the catalogue rather than written into every row.

---

## 3. CHECK constraints: business rules the database enforces

A **CHECK constraint** is a boolean expression that every row must satisfy. The schema has 17 of them. They fall into three families.

**Allowed values (enumerations).** The column is a `varchar`, and the CHECK lists the allowed values:

```sql
CHECK (strategy IN ('least_loaded','round_robin'))                          -- assignment_rules
CHECK (status IN ('sent','delivered','failed'))                              -- communication_delivery_receipts
CHECK (channel_key IN ('email','portal','mobile','phone','internal'))        -- intake_channels
```

**Ranges and sanity.** Numbers must make sense:

```sql
CHECK (retention_years BETWEEN 1 AND 99)                                     -- ticket_categories
CHECK (start_minute >= 0 AND end_minute <= 1440 AND start_minute < end_minute) -- business_hours
CHECK (acknowledge_business_days >= 0 AND final_response_calendar_days >= 1 AND at_risk_days >= 0)
```

**Relationships between columns in one row.** These express real business rules:

```sql
CHECK (source_ticket_id <> target_ticket_id)                                 -- a ticket cannot link to itself
CHECK (queue_key <> escalate_to_queue)                                       -- escalation must go somewhere else
CHECK (recipient_user IS NOT NULL OR (recipient_queue IS NOT NULL AND audience_role IS NOT NULL))  -- a notification needs an audience
```

The last one is worth dwelling on. A notification can target a person or a role-in-queue. The rule "at least one complete audience" spans three columns. In code, `NotificationsService.create` also returns early when there is no audience ([notifications.service.ts#L21](../../apps/api/src/notifications/notifications.service.ts#L21)), but the CHECK makes it impossible for *any* path to store an orphan notification that nobody would ever see.

### The NULL trap in CHECK constraints

A CHECK **passes** when its expression is true **or NULL**. Only false fails. Because `NULL IN ('a','b')` evaluates to NULL, a plain `CHECK (root_cause IN (...))` would already allow NULL root causes. The migrations write `root_cause IS NULL OR root_cause IN (...)` anyway ([migration 17000#L5](../../apps/api/migrations/1710000017000_sla_accuracy_root_cause.cjs#L5)). That is not required, but it documents the intent: "NULL is allowed on purpose". If you ever want "must be one of these and must be present", you need `NOT NULL` as well; the CHECK alone will not do it.

### Changing a CHECK constraint

You cannot edit a constraint in place. The migrations drop it and add a new one. When complaint outcomes gained the privacy outcomes, [migration 27000#L9-L10](../../apps/api/migrations/1710000027000_privacy_correction.cjs#L9-L10) did exactly that:

```js
pgm.dropConstraint('tickets', 'tickets_idr_outcome_chk');
pgm.addConstraint('tickets', 'tickets_idr_outcome_chk', { check: "idr_outcome IS NULL OR idr_outcome IN (..., 'corrected', 'corrected_with_statement', 'refused_with_reasons')" });
```

Adding a CHECK makes PostgreSQL scan the whole table to prove existing rows comply, holding a lock that blocks writes meanwhile. On a very large table you would add it `NOT VALID` (enforced for new rows immediately) and run `VALIDATE CONSTRAINT` separately, which only needs a weaker lock. At our size the simple form is fine; [migrations](migrations-and-roles.md#4-writing-a-safe-migration) discusses this.

---

## 4. Foreign keys and ON DELETE

A **foreign key** guarantees that a reference points at something real. Insert a note with a made-up `ticket_id` and PostgreSQL refuses (`23503`). The other half of the guarantee is about deletes: what if someone deletes the parent? That is what the `ON DELETE` action decides.

| Action | Meaning | Where we use it, and why |
|---|---|---|
| `RESTRICT` | Refuse to delete a parent that still has children | **All case data**: notes, history, attachments, references, communications, escalations, upload links, intake messages. A case's evidence must never disappear because someone deleted a ticket row. Retention *redacts* content instead of deleting rows ([retention.service.ts#L43-L47](../../apps/api/src/retention/retention.service.ts#L43-L47)) |
| `NO ACTION` (the default when nothing is specified) | Like RESTRICT, but checked at the end of the statement (or transaction, if deferred) | `idempotency_records.response_ticket_id`, `approval_requests.ticket_id`. In practice identical to RESTRICT here |
| `CASCADE` | Deleting the parent deletes the children | **Things that only exist to serve the parent**: `notification_reads` (a read marker without its notification is meaningless), `notifications.ticket_id`, `queue_members` and rules when a queue is deleted, `workflow_transitions` when a workflow is deleted, delivery receipts and approval links with their communication |

The choice is a business decision expressed as schema. CASCADE says "this child has no independent value". RESTRICT says "this child is evidence; make deletion an explicit, deliberate act".

You can see RESTRICT working in [lab 3](hands-on-labs.md#lab-3-constraints-refuse-bad-data):

```text
ERROR:  update or delete on table "tickets" violates foreign key constraint
        "ticket_references_ticket_id_fkey" on table "ticket_references"
DETAIL: Key (id)=(0003048c-...) is still referenced from table "ticket_references".
```

The first child table that still references the ticket blocks the delete. Without references it would be `ticket_escalations`, `ticket_notes`, and so on: every case table says RESTRICT.

### PostgreSQL does not index foreign-key columns for you

This surprises many people. A foreign key creates an index on the **parent's** key (it must be a primary key or unique), but **not** on the child's referencing column. Without an index on the child column, two things get slow as the child table grows:

1. Queries like "all references for this ticket" must scan the whole child table.
2. Deleting a parent (or updating its key) must scan the child table to check for references.

Running a catalogue query against our schema ([lab 13](hands-on-labs.md#lab-13-find-foreign-keys-without-an-index)) shows 15 foreign-key columns without a leading index. Most are on small configuration tables and do not matter. Four reference `tickets` and will grow:

| Child column | Queried by the app? | Risk |
|---|---|---|
| `ticket_references.ticket_id` | **Yes**, on every ticket detail view ([tickets.service.ts#L353](../../apps/api/src/tickets/tickets.service.ts#L353)) and every reveal | Real: measured below |
| `approval_requests.ticket_id` | Lookups are by `id` and `communication_id` (indexed) | Low |
| `intake_messages.ticket_id` | Lookups are by the PK `(channel, message_id)` | Low |
| `notifications.ticket_id` | Only by the CASCADE when a ticket is deleted (which never happens) | Low |

Measured on the lab database with 100,000 reference rows ([lab 13](hands-on-labs.md#lab-13-find-foreign-keys-without-an-index)):

```text
--- without index
 Seq Scan on ticket_references (actual rows=2 loops=1)
   Rows Removed by Filter: 99998
 Execution Time: 6.285 ms
--- with index on ticket_references(ticket_id)
 Index Scan using lab_ref_ticket on ticket_references (actual rows=2 loops=1)
 Execution Time: 0.086 ms
```

Reading 100,000 rows to find 2 is about 70 times slower, and it grows linearly with the table. **Recommended hardening:** a migration adding `CREATE INDEX ON ticket_references (ticket_id)`.

---

## 5. UNIQUE constraints and primary keys as business rules

A primary key or UNIQUE constraint is usually described as "no duplicates". In this codebase it is something stronger: **the database's atomic answer to "has this already happened?"**

| Constraint | Business rule it enforces |
|---|---|
| `idempotency_records PK (actor_id, idempotency_key)` | One person's retried "create ticket" request creates one ticket |
| `intake_messages PK (channel, message_id)` | One inbound email becomes one ticket, however often it is redelivered |
| `ticket_escalations UNIQUE (ticket_id, rule_key)` | A ticket escalates at most once per rule, across all scheduler ticks and instances |
| `notification_reads PK (notification_id, user_id)` | Marking read twice is harmless |
| `integration_receipts UNIQUE (outbox_event_id, external_system)` | Each external system acknowledges an event once |
| `communication_delivery_receipts UNIQUE (communication_id, provider, provider_message_id, status)` | Each provider callback is recorded once |
| `ticket_relationships PK (source, target, type)` | No duplicate links |
| `attachments.object_key UNIQUE` | Two attachment rows can never point at the same stored file |
| `audit_anchors.sequence UNIQUE` | One anchor per chain position |

The code uses these in two ways. The quiet way is `INSERT ... ON CONFLICT DO NOTHING RETURNING id`: if no row comes back, someone else already did it ([escalation.service.ts#L50-L51](../../apps/api/src/workflow/escalation.service.ts#L50-L51)). The loud way is to let the insert fail and translate the error, as `linkTicket` does ([tickets.service.ts#L262-L263](../../apps/api/src/tickets/tickets.service.ts#L262-L263)):

```ts
try { await client.query('INSERT INTO ticket_relationships ...', [...]); }
catch (error) { if (error instanceof Error && error.message.includes('ticket_relationship_pk')) throw new ConflictException('Relationship already exists'); throw error; }
```

The `pg` driver's error object also carries `error.code` (`'23505'`) and `error.constraint` (`'ticket_relationship_pk'`). Matching on those is more robust than matching message text, which can change with the server's language setting. Note too that after this error the transaction is aborted; the code rethrows, so the helper rolls back, which is correct. Catching it and *continuing* would not work ([why](transactions.md#5-errors-inside-a-transaction-the-aborted-state)).

### Partial unique index: unique for some rows only

Sometimes uniqueness only applies to a subset. An approval request may or may not belong to a communication; if it does, there must be only one per communication. [Migration 8000#L6](../../apps/api/migrations/1710000008000_communication_approvals.cjs#L6):

```js
pgm.createIndex('approval_requests', ['communication_id'], { unique: true, where: 'communication_id IS NOT NULL' });
```

Strictly, a plain UNIQUE would also allow many NULLs (in PostgreSQL, NULLs are not equal to each other, so they never clash). The partial index is still better: it is smaller, because rows without a communication are not in it at all, and it states the intent precisely.

---

## 6. Triggers: rules that need code

A **trigger** runs a function automatically when a table changes. The schema uses them for one job: making the audit trail append-only.

```sql
-- migration 10000: refuse UPDATE and DELETE, row by row
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();
-- migration 23000: TRUNCATE skips row triggers, so refuse it at statement level too
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION deny_audit_mutation();
```

`BEFORE` means the function runs before the change is applied, so raising an exception stops it. `FOR EACH ROW` runs once per affected row; `FOR EACH STATEMENT` once per statement (TRUNCATE has no rows to iterate, so it needs the statement form). Lab output:

```text
UPDATE audit_events SET outcome='denied';   → ERROR:  audit_events is append-only
DELETE FROM audit_events;                   → ERROR:  audit_events is append-only
TRUNCATE audit_events;                      → ERROR:  audit_events is append-only
```

A trigger's limitation: the table **owner** can `ALTER TABLE ... DISABLE TRIGGER`. That is why the app does not run as the owner, and why privileges are revoked as well ([migrations and roles](migrations-and-roles.md#5-roles-owner-app-reporting)). The full layered story is in [Audit: database protection](../audit/database-protection.md).

Why not use triggers for more, such as updating `updated_at` automatically or writing status history? Triggers are invisible when reading the service code, they make behaviour harder to test, and they fire on every path including bulk maintenance. The project keeps business behaviour in services where it is visible, and uses triggers only for **protective** rules that must hold no matter who writes.

---

## 7. Rules we deliberately do NOT enforce in the database

Being honest about the boundary is part of mastery. These rules live in code:

| Rule | Where it is enforced | Why not in the schema |
|---|---|---|
| Status transitions follow the workflow | [WorkflowDefinitionService.assertTransition](../../apps/api/src/workflow/workflow-definition.service.ts) | The graph is data in other tables and depends on the user's roles; a CHECK cannot look at other tables |
| `assigned_to` is an active member of the queue | Should be the assignment service (currently a [known gap](../reference/data-and-consistency-map.md#manual-assignee-validation)) | Staff live in the identity provider, not in a table we can reference |
| A ticket's legal entity matches its queue's | Create and intake paths ([intake.service.ts#L46-L47](../../apps/api/src/intake/intake.service.ts#L46-L47)) | Would need a composite FK or a trigger; possible future hardening |
| `ticket_status_history` is append-only | Convention: the code only inserts | Could be protected like audit; it is not evidence in the regulatory sense |

A CHECK can only see **the row being written**. Rules that need other tables require a foreign key (for existence), a trigger, or application code inside a transaction with the right lock.

---

## 8. Check yourself

1. Why is a unique constraint safe against two simultaneous requests when `SELECT` then `INSERT` in code is not?
2. A CHECK is `CHECK (status IN ('a','b'))`. Can `status` be NULL? How would you forbid it?
3. Why are notes `ON DELETE RESTRICT` but notification reads `ON DELETE CASCADE`?
4. Which index would you add first, and how would you prove it helps?
5. Why does the audit table need two triggers?

Next: [Indexes and query plans](indexes-and-query-plans.md)
