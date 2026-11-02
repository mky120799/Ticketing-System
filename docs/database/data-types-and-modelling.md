# Data types and modelling

[Back to Database index](README.md) · Terms: [concepts](concepts.md) · Next: [Schema tour](schema-tour.md)

Before you can reason about transactions or locks, you need to be fluent in the *shape* of data: what a table really is, why a column has the type it has, and how tables point at each other. This page builds that fluency using the `tickets` table and its neighbours.

---

## 1. What a table really is

A table is a **set of rows that all share the same columns**. Two properties matter more than they first appear.

First, **rows have no built-in order**. PostgreSQL stores rows wherever there is space, and a plain `SELECT * FROM tickets` may return them in any order, and a different order tomorrow. That is why every list query in the code has an explicit `ORDER BY` (for example `ORDER BY created_at DESC, id DESC` in [tickets.service.ts#L79](../../apps/api/src/tickets/tickets.service.ts#L79)). If you ever rely on "the order they were inserted", you have a bug that only shows up later.

Second, **a column's type is a contract**. Declaring `created_at timestamptz NOT NULL` means every row, forever, has a real point in time there. Code reading that column never needs to handle "maybe a string, maybe missing". The database refuses any write that would break the contract, so the contract holds even for code you have not written yet.

Here is the first version of `tickets`, from [migration 0000#L3](../../apps/api/migrations/1710000000000_initial.cjs#L3), reformatted:

```js
pgm.createTable('tickets', {
  id:            { type: 'uuid', primaryKey: true },
  category:      { type: 'varchar(80)',  notNull: true },
  priority:      { type: 'varchar(20)',  notNull: true },
  status:        { type: 'varchar(30)',  notNull: true, default: 'submitted' },
  sensitivity:   { type: 'varchar(20)',  notNull: true, default: 'standard' },
  queue:         { type: 'varchar(80)',  notNull: true },
  branch_code:   { type: 'varchar(30)',  notNull: true },
  department:    { type: 'varchar(80)',  notNull: true },
  legal_entity:  { type: 'varchar(50)',  notNull: true },
  country:       { type: 'varchar(2)',   notNull: true },
  subject:       { type: 'varchar(200)', notNull: true },
  description:   { type: 'text',         notNull: true },
  custom_fields: { type: 'jsonb',        notNull: true, default: '{}' },
  created_by:    { type: 'varchar(160)', notNull: true },
  assigned_to:   { type: 'varchar(160)' },                        // NULL = unassigned
  created_at:    { type: 'timestamptz',  notNull: true, default: pgm.func('current_timestamp') },
  updated_at:    { type: 'timestamptz',  notNull: true, default: pgm.func('current_timestamp') }
});
```

Almost every column is `NOT NULL`. That is deliberate. A nullable column means "this fact may be unknown", and the code then has to decide what unknown means everywhere it reads the column. Only `assigned_to` is nullable here, because "nobody is assigned yet" is a real, meaningful state.

---

## 2. The data types we use, and why

### `uuid`: identifiers for things we create

A **UUID** (universally unique identifier) is a 128-bit random value such as `dd8a043a-e38f-4b1c-...`. The code generates it with `randomUUID()` *before* inserting ([tickets.service.ts#L43](../../apps/api/src/tickets/tickets.service.ts#L43)).

Why not an auto-incrementing integer (1, 2, 3...)?

- **The ID is known before the insert.** The code needs the new ticket's ID to write its references, its idempotency record, its audit event and its outbox event, all in the same transaction. With a random UUID it simply makes one up first.
- **IDs leak nothing.** Ticket 1043 tells an attacker there are about 1043 tickets and that 1044 probably exists. A random UUID cannot be guessed, which matters because portal customers see their ticket IDs.
- **No coordination.** Several API instances can create IDs at once without asking the database for the next number.

The cost: a UUID is 16 bytes (a `bigint` is 8), and random values scatter inserts across the index instead of always appending at the end. At our scale that is fine. Note `audit_events` is the exception: it has a `bigserial` `sequence` as its primary key *and* a `uuid` `id` ([migration 0000#L9](../../apps/api/migrations/1710000000000_initial.cjs#L9)), because the hash chain needs a strict, gap-checkable order.

### `bigserial` / `bigint`: strict order

`bigserial` is a `bigint` column whose default comes from a **sequence** (a database counter that hands out increasing numbers). The audit chain uses it so "the previous event" is simply "the row with the next-lower sequence" ([audit.service.ts#L17](../../apps/api/src/audit/audit.service.ts#L17)). Sequences are not transactional: a rolled-back insert still consumes its number, so gaps are normal and are not evidence of tampering by themselves.

### `varchar(n)` vs `text`

In PostgreSQL `varchar(n)` and `text` are stored identically; `varchar(n)` just adds a length check. The project uses `varchar(n)` for **controlled, short values** (status, queue, country) so a bug cannot store a 5 MB "status", and `text` for **free text** (`description`, `body`). The limits double as documentation: `title varchar(160)` on notifications says "a notification is one short line".

Changing a length later is a migration. That happened: `sla_status` grew from 20 to 40 characters in [migration 11000](../../apps/api/migrations/1710000011000_sla_status_width.cjs#L2) when `first_response_overdue` (22 characters) arrived.

### Why statuses are `varchar` + `CHECK` and not PostgreSQL `ENUM`

PostgreSQL has a native `ENUM` type, but adding or removing a value means altering the type, and values cannot easily be removed. The project instead stores a `varchar` and adds a **CHECK constraint** listing the allowed values, for example the root-cause list in [migration 17000#L5](../../apps/api/migrations/1710000017000_sla_accuracy_root_cause.cjs#L5). Extending it is a drop-and-re-add of the constraint, which several migrations do (see [constraints](constraints-and-integrity.md#3-check-constraints-business-rules-the-database-enforces)). Ticket `status` itself has no CHECK at all because statuses are **data**: the workflow tables define which exist ([migration 19000](../../apps/api/migrations/1710000019000_workflow_definitions.cjs)).

### `timestamptz`: always

`timestamptz` ("timestamp with time zone") stores an absolute instant in UTC and converts to the session's time zone only for display. The alternative, `timestamp` (without time zone), stores wall-clock digits with no zone, so "09:00" in Sydney and "09:00" in Mumbai look identical. A bank operating in Australia and India must never confuse those. **Every** time column in this schema is `timestamptz`.

The one exception is `business_holidays.holiday_date` of type `date` ([migration 18000#L21](../../apps/api/migrations/1710000018000_regulatory_complaints.cjs#L21)): a public holiday is a calendar day in a country, not an instant.

### `boolean`

Flags such as `active`, `legal_hold`, `is_complaint`. Always `NOT NULL DEFAULT false` (or `true`) so there is no third "unknown" state.

### `integer` and minutes

Durations are stored as plain integers with the unit in the name: `first_response_minutes`, `retention_years`, `start_minute`. That keeps arithmetic simple and makes the unit impossible to misread.

### `jsonb`: flexible fields, used sparingly

`jsonb` stores a JSON document in a binary, indexable format. The only business use is `tickets.custom_fields`: banks define their own extra fields, and the platform cannot know them in advance. The audit `metadata` column also uses it.

Why sparingly? Values inside JSON have no types, no foreign keys, and no NOT NULL. If something is core to the product (status, queue, priority), it gets a real column. A good rule: **if you will filter, join or constrain on it, make it a column.**

### Arrays: `text[]` and `integer[]`

PostgreSQL columns can hold arrays. `workflow_transitions.allowed_roles text[]` holds the roles that may perform a transition, with NULL meaning "anyone" ([migration 19000#L16](../../apps/api/migrations/1710000019000_workflow_definitions.cjs#L16)). `business_hours.working_days integer[]` holds `{1,2,3,4,5}`. Arrays are convenient for small lists that are read as a whole. They are a poor fit for lists you need to join or enforce foreign keys on; for those, use a child table (as `queue_members` does).

Arrays are also how the code passes **lists as one parameter**: `queue = ANY($3::text[])` sends the user's queues as a single array value ([tickets.service.ts#L78](../../apps/api/src/tickets/tickets.service.ts#L78)). See [SQL patterns](sql-patterns.md#3-any1text-a-list-as-one-parameter).

---

## 3. Defaults

A **default** is the value used when an insert does not mention the column. They do real work here:

- `status DEFAULT 'submitted'`: a new ticket starts at the start of the workflow.
- `created_at DEFAULT current_timestamp`: the database stamps the time, so it cannot be forged by a client clock.
- `next_attempt_at DEFAULT current_timestamp` on the outbox: a new event is due immediately.

Note `current_timestamp` (same as `now()`) returns the **start time of the current transaction**, not the current wall-clock moment. Every row written in one transaction gets exactly the same `now()`. That is usually what you want (one business event, one timestamp), and it is why `assertFresh` can compare `updated_at` values exactly.

---

## 4. Keys: how rows are identified and connected

### Primary keys

Every table has one. Three styles appear:

| Style | Example | When we use it |
|---|---|---|
| Surrogate UUID | `tickets.id`, `notifications.id` | Things the app creates |
| Natural key | `case_queues.queue_key`, `business_hours.country` | Configuration with stable human names |
| Composite natural key | `idempotency_records (actor_id, idempotency_key)`, `intake_messages (channel, message_id)`, `notification_reads (notification_id, user_id)`, `workflow_transitions (workflow_key, from_status, to_status)` | When identity *is* a combination |

The composite keys are where the database does business logic for free. `notification_reads` having the primary key `(notification_id, user_id)` *is* the rule "a person reads a notification at most once". `intake_messages (channel, message_id)` *is* the rule "the same email is never turned into two tickets".

### Foreign keys

A foreign key says "this value must exist over there". `ticket_notes.ticket_id REFERENCES tickets` means the database rejects a note for a ticket that does not exist, and (with `RESTRICT`) rejects deleting a ticket that still has notes. [Constraints and integrity](constraints-and-integrity.md#4-foreign-keys-and-on-delete) explains the choices of RESTRICT vs CASCADE.

Some "references" are deliberately **not** foreign keys. `tickets.assigned_to` and `created_by` hold identity-provider subject IDs; staff live in the bank's identity provider, not in our tables, so there is nothing to reference. `staff_directory` only *decorates* those IDs with names ([migration 30000](../../apps/api/migrations/1710000030000_staff_directory.cjs)).

---

## 5. Normalisation: each fact in one place

**Normalisation** is the discipline of storing each fact exactly once. The classic forms in plain words:

- **First normal form (1NF):** each cell holds one value, and there are no repeating groups like `note1`, `note2`, `note3` columns. Our notes live in their own table, one row per note.
- **Second normal form (2NF):** with a composite key, every other column depends on the *whole* key. In `notification_reads (notification_id, user_id, read_at)`, `read_at` depends on both: when *this person* read *this notification*.
- **Third normal form (3NF):** no column depends on another non-key column. A queue's department and legal entity live on `case_queues`, not copied onto every category.

You can see normalisation in how the project grew. A ticket's notes, status history, attachments, communications, references, relationships and retention controls each got **their own table** with a `ticket_id` foreign key, rather than columns or JSON on `tickets`. That is why the detail endpoint runs one query per child table ([tickets.service.ts#L353-L359](../../apps/api/src/tickets/tickets.service.ts#L353-L359)).

### Where we denormalise on purpose

Denormalising means copying a fact. It is right when the copy has a different meaning from the original:

- **History snapshots.** `ticket_status_history.from_status/to_status` and `ticket_escalations.from_queue/to_queue` record what was true *then*. The ticket's current status is a different fact.
- **Scope on the row.** `tickets` carries `legal_entity`, `country` and `department` even though the queue implies them. Access checks and the paging index need them on the ticket itself, without a join, and a ticket's scope must not silently change if a queue is reconfigured.
- **Notifications carry scope.** `notifications.legal_entity/country` copies the ticket's scope so the inbox query can filter without joining tickets.

The rule of thumb: **normalise facts that should stay in sync; denormalise facts that are snapshots or that a hot query needs.**

---

## 6. Modelling a lifecycle: state on the row, history in a table

A ticket moves through statuses. The model stores the **current state** on the row (`tickets.status`, plus timestamps like `resolved_at`, `closed_at`) and the **history** as append-only rows (`ticket_status_history`). The transition endpoint writes both in one transaction ([tickets.service.ts#L174](../../apps/api/src/tickets/tickets.service.ts#L174) and [L183-L189](../../apps/api/src/tickets/tickets.service.ts#L183-L189)).

The *rules* for moving between states are data too: `workflow_transitions` lists every legal `(from_status, to_status)` pair, and the composite primary key makes each pair appear once. This pattern (current state + history + rules as data) recurs in communications, outbox events and attachments.

---

## 7. Check yourself

1. Why does `tickets.id` use `uuid` while `audit_events.sequence` uses `bigserial`?
2. Two rows are inserted in one transaction a second apart. Do they get different `created_at` values? Why?
3. Why is `assigned_to` not a foreign key?
4. Give one example of deliberate denormalisation and justify it.
5. When would you move a value out of `custom_fields` into a real column?

Answers are in this page; [interview Q&A](interview-qa.md) has model answers.

Next: [Schema tour](schema-tour.md)
