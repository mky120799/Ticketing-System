# Database module

Database centralizes PostgreSQL connection lifecycle, transaction handling and runtime-role safety checks. Domain modules receive `PgService`; they do not create ad-hoc pools.

## Pool and transaction helper

[`PgService`](../../apps/api/src/database/pg.service.ts) creates a bounded `pg.Pool` using `DATABASE_URL`. Important controls are:

- `DATABASE_POOL_MAX` (default 20);
- connection timeout (default 10 seconds);
- statement timeout (default 60 seconds);
- idle-in-transaction timeout (default 60 seconds).

These limits fail predictably rather than allowing a saturated pool or stuck statement to hold resources indefinitely. `onModuleDestroy` closes the pool during graceful Nest shutdown.

`transaction` checks out one client, issues `BEGIN`, awaits the supplied operation, commits on success and rolls back on every thrown error, releasing the client in `finally`:

```ts
return db.transaction(async (client) => {
  await client.query(/* domain write */);
  await audit.write(client, event);
  await outbox.enqueue(client, message);
});
```

Passing the same client is the atomicity boundary. Calling `db.query` from inside that callback would use another pool connection and would not participate in the transaction; services that support both contexts accept an optional client deliberately.

## Runtime privilege guard

[`DatabaseGuardService`](../../apps/api/src/database/database-guard.service.ts) runs at startup and asks PostgreSQL whether the current role is a superuser, owns `audit_events`, or can update/delete/truncate it. A safe application role may append through approved privileges but cannot rewrite evidence.

In production, `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` turns an unsafe report into startup failure. Otherwise development logs a warning. Migrations run under a separate owner role defined in [`infra/postgres/roles.sql`](../../infra/postgres/roles.sql); the API uses the restricted runtime account. Metrics expose the resulting safe/unsafe bit.

## Migrations, queries and concurrency

Schema evolution is in [`apps/api/migrations`](../../apps/api/migrations). Application SQL uses bound parameters. Row locks protect aggregates during multi-step mutation; `SKIP LOCKED` distributes background queues; advisory locks serialize scheduler/queue-level work; unique constraints are the final defense for idempotency.

Transactions should be short: do not wait on email, Kafka, S3 or other networks while holding a database lock. The outbox and post-commit mechanisms exist specifically to move those operations outside the business transaction.

## Frontend impact, tests and interview answer

The frontend never connects to PostgreSQL. API error mapping should translate known constraint/concurrency failures into stable HTTP responses without exposing SQL, schema or connection details.

Test commit/rollback/release, timeouts, constrained pool behavior, runtime-role reports and startup fail mode. Production safety coverage is in [`production-safety.spec.ts`](../../apps/api/test/production-safety.spec.ts).

> I use one injectable bounded PostgreSQL pool and a transaction callback that always commits, rolls back and releases correctly. Domain writes pass the same client to audit and outbox, giving atomic case state and evidence. Migrations use an owner role, while the runtime role is checked at startup to ensure it cannot update, delete or truncate audit events. Long external calls stay outside transactions.
