# Database: PostgreSQL usage, transactions and locking

> **PostgreSQL is the single source of truth.** Tickets, audit, outbox, notifications, configuration and even live-event signalling all go through it. Redis is an optional cache, Kafka is downstream, and object storage holds file bytes.
> **Transaction**: a group of statements that all succeed (COMMIT) or all vanish (ROLLBACK).
> **Lock**: a way to stop two transactions from interfering. We use row locks, `SKIP LOCKED` queues, advisory locks and unique constraints, each for a specific job.
> In plain words: one ledger, written carefully, with clear rules for who may write which page at the same time.

## Where it lives

| File | Role |
|---|---|
| [database/pg.service.ts](../../apps/api/src/database/pg.service.ts) | Bounded pool, `query`, `transaction` |
| [database/database-guard.service.ts](../../apps/api/src/database/database-guard.service.ts) | Startup check: can the runtime role tamper with audit? |
| [database/database.module.ts](../../apps/api/src/database/database.module.ts) | `@Global` export |
| [apps/api/migrations/](../../apps/api/migrations/) | 31 numbered `node-pg-migrate` migrations |
| [scripts/migrate.mjs](../../apps/api/scripts/migrate.mjs) | Container migration job entry |
| [infra/postgres/roles.sql](../../infra/postgres/roles.sql) | Owner / app / reporting roles |

## Read in this order

1. [Pool and transactions](pool-and-transactions.md): `PgService`, timeouts, the transaction helper, the "same client" rule.
2. [Locking and concurrency catalogue](locking-and-concurrency.md): every locking technique in the codebase, with where and why (great for interviews).
3. [Migrations and roles](migrations-and-roles.md): how the schema evolves, the owner/app split, reporting views.
4. [Interview Q&A](interview-qa.md)

## 30-second answer

> One injectable, bounded `pg` pool with connection, statement and idle-in-transaction timeouts, and a `transaction(callback)` helper that always commits, rolls back and releases. Every use case passes that one `PoolClient` to the business writes, audit, outbox and `pg_notify`, which gives atomicity. For concurrency I use the right primitive per job: row locks for read-check-write, `SKIP LOCKED` for work queues, advisory locks for "one at a time" decisions, and unique constraints as the final idempotency guard. Migrations run as an owner account; the app runs as a restricted account that can't rewrite audit.

## Related

[Audit database protection](../audit/database-protection.md) · [Outbox claims](../outbox/how-it-works.md) · [Tickets concurrency gap](../tickets/mutations-and-concurrency.md#3-the-concurrency-gap-be-honest-about-this) · [Operations: capacity, DR](../operations/README.md)
