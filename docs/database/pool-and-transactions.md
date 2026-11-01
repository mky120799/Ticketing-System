# Pool and transactions

[Back to Database index](README.md) · Code: [pg.service.ts](../../apps/api/src/database/pg.service.ts)

---

## 1. The pool

[pg.service.ts#L8-L14](../../apps/api/src/database/pg.service.ts#L8-L14):

```ts
private readonly pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 60_000),
  idle_in_transaction_session_timeout: Number(process.env.DATABASE_IDLE_IN_TRANSACTION_MS ?? 60_000)
});
```

| Setting | Plain meaning | Failure it prevents |
|---|---|---|
| **Connection pool** (`max: 20`) | Reuse up to 20 open connections instead of opening one per request | Connection storms; PostgreSQL has hard connection limits |
| `connectionTimeoutMillis` | Wait at most 10 s for a free connection | When the pool is saturated, requests fail fast instead of hanging forever |
| `statement_timeout` | Kill any single SQL statement after 60 s | A runaway query can't hold locks indefinitely |
| `idle_in_transaction_session_timeout` | Kill a session that opened a transaction and went quiet for 60 s | A stuck request holding the **audit advisory lock** would otherwise block every audited write ([comment L6-L7](../../apps/api/src/database/pg.service.ts#L6-L7)) |

`onModuleDestroy` → `pool.end()` for graceful shutdown ([L22](../../apps/api/src/database/pg.service.ts#L22)).

## 2. The transaction helper

[L16-L21](../../apps/api/src/database/pg.service.ts#L16-L21):

```ts
async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
```

| Line | Guarantee |
|---|---|
| `pool.connect()` | One dedicated connection for the whole callback |
| `BEGIN` ... `COMMIT` | All or nothing |
| `catch → ROLLBACK → rethrow` | Any thrown error (policy 403, 409, SQL error) undoes everything and still reaches the HTTP layer |
| `finally release()` | The connection always returns to the pool, even on error, so there are no leaks |

## 3. The "same client" rule

**A transaction only covers statements run on its own client.** If code inside the callback calls `this.db.query(...)`, that runs on **another** pool connection, outside the transaction.

```ts
// RIGHT: atomic
await db.transaction(async (client) => {
  await client.query('UPDATE tickets ...');
  await audit.write(client, ...);          // same client
  await outbox.enqueue(client, ...);       // same client
});
// WRONG: audit could commit while the ticket update rolls back
await db.transaction(async (client) => {
  await client.query('UPDATE tickets ...');
  await db.query('INSERT INTO audit_events ...');   // different connection!
});
```

That's why `AuditService.write`, `OutboxService.enqueue`, `LiveEventsService.notify`, `NotificationsService.create` and most sub-services take a `client` parameter. `WorkflowDefinitionService.nextStatuses` accepts an optional client for the same reason, and also to avoid a **pool deadlock**: holding one connection while waiting for another, when all 20 are held by requests doing the same thing ([workflow-definition.service.ts#L46](../../apps/api/src/workflow/workflow-definition.service.ts#L46)).

## 4. Keep transactions short

Never wait on the network while holding a transaction:

| Network call | Done outside the transaction | Where |
|---|---|---|
| Presigning S3 URLs | after commit (`.then`) | [tickets.service.ts#L208-L210](../../apps/api/src/tickets/tickets.service.ts#L208-L210) |
| Publishing to Kafka | between claim and mark transactions | [outbox.service.ts#L18-L26](../../apps/api/src/outbox/outbox.service.ts#L18-L26) |
| Sending email/SMS | after the lease transaction | [delivery.worker.ts#L43-L51](../../apps/api/src/email/delivery.worker.ts#L43-L51) |
| Deleting S3 objects | before the redaction transaction | [retention.service.ts#L37-L38](../../apps/api/src/retention/retention.service.ts#L37-L38) |
| Streaming to ClamAV | outside any transaction | [attachment-scan.worker.ts#L38-L40](../../apps/api/src/tickets/attachment-scan.worker.ts#L38-L40) |

## 5. Isolation level

All transactions use PostgreSQL's default **READ COMMITTED**: each statement sees data committed before *that statement* started. It's fast and simple, and it's why explicit locks (next page) are needed for read-check-write sequences.

## 6. Parameterised SQL only

Every value is a `$n` parameter. The only interpolated SQL fragments are fixed strings from code: the SLA status formula, escalation trigger SQL, assignment `ORDER BY`, and the table/where of `AuditService.previous`. Each is marked with a comment saying it is never from input. This is the SQL-injection defence.

Next: [Locking and concurrency catalogue](locking-and-concurrency.md)
