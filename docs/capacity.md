# Capacity and performance

## Measured baseline

`loadtest/run.mjs` (autocannon) against the full stack on one developer laptop, every dependency in containers (PostgreSQL, Keycloak, Kafka, object store, ClamAV, mail server all running alongside the API), 15 seconds per scenario, 30 connections (20 for writes, 10 for the dashboard). Zero errors, timeouts or non-2xx responses in any scenario.

| Scenario | Requests/s | p50 | p99 | Notes |
|---|---|---|---|---|
| Health check (database ping) | ~6,300 | 4 ms | 12 ms | framework and pool overhead |
| List tickets (authenticated, scoped, **audited**) | ~950 | 28 ms | 70 ms | each list view writes an audit event |
| Dashboard summary (aggregates over ~3,400 tickets) | ~850 | 11 ms | 23 ms | |
| **Create ticket** via intake (SLA, assignment, audit, outbox, live event, regulatory clock) | ~230 | 81 ms | 183 ms | several audit events per request, serialised by the audit chain |

After the run the audit trail held 33,971 events and a **full verification reported valid**: concurrent writers did not damage the chain.

**What this means.** A bank's complaints and service-request volume is normally well under one new case per second even at national scale, so write throughput of 200+ per second per instance leaves a very large margin. These are laptop numbers for comparison and regression-spotting, not a capacity promise; the bank's load test on its own infrastructure must set the real figures.

## The one deliberate bottleneck

Audit events are written one at a time (a single database lock keeps the hash chain in order). This is what limits write throughput, and it is the price of a tamper-evident, gap-free chain. If a deployment ever needed more: turn off per-request list-view auditing (`AUDIT_LIST_VIEWS=false`) to remove the largest source of audit volume, then consider partitioned chains (one per legal entity). Read endpoints scale with API replicas and database read capacity.

## Storage growth (measured)

| Item | Approx. size |
|---|---|
| One audit event (including indexes) | ~0.9 KB |
| One ticket row (including indexes) | ~0.7 KB; add status history, references, notes and outbox rows: plan ~5-8 KB per ticket excluding attachments |
| Attachments | stored in object storage; up to 25 MB each |

Example: 200,000 cases a year at ~40 audit events per case is ~8 million events, about **7 GB a year** of audit data and roughly **1.5 GB** of case data. List-view auditing is the main contributor to audit volume; it records one event per list request, not per ticket. Archive old audit events with the verified archive procedure (`deployment.md`) rather than letting the live table grow without bound.

## Sizing guidance

| Component | Starting point | Scale by |
|---|---|---|
| API | 2 replicas, 0.25-1 CPU, 384-768 MiB each (chart defaults); autoscale on CPU | read traffic, concurrent live streams (each is one open connection per user) |
| PostgreSQL | managed HA instance, 2-4 vCPU, 8-16 GB RAM, SSD | write rate, dashboard concurrency; add a read replica for BI if needed |
| Connection pool | `DATABASE_POOL_MAX=20` per API instance; total across instances must stay under the database's connection limit | replicas x pool size |
| Object storage | per attachment policy | attachment volume |
| Kafka | the bank's cluster; one partition per aggregate type is enough at this volume | event volume |

## Operating limits already built in

Per-client rate limit (`RATE_LIMIT_PER_MINUTE`, per instance), 1 MiB request bodies, 5 live streams per user, batch sizes (500 SLA updates per tick, 25 outbox events per batch, 10 deliveries/scans per pass), database connection, statement and idle-in-transaction timeouts, so one slow request cannot hold the audit lock indefinitely.

## Running it yourself

```bash
RATE_LIMIT_PER_MINUTE=1000000 docker compose --profile app up -d api   # lift the API rate limit for the test
cd loadtest && npm install && DURATION=60 CONNECTIONS=100 npm test
```

Never run it against a shared or production environment: it creates thousands of tickets.
