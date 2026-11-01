# Observability: metrics, health and logs

> **Observability**: being able to tell from the outside whether the system is healthy and why not, using **metrics** (numbers over time), **health checks** (is it alive and ready?) and **logs** (what happened).
> **Prometheus**: a monitoring system that *scrapes* (pulls) a `/metrics` text page every few seconds and stores the numbers; alert rules fire when numbers cross thresholds.
> In plain words: the system's dashboard lights and alarm bells, wired so they never show customer data.

## Where it lives

| File | Role |
|---|---|
| [metrics/metrics.service.ts](../../apps/api/src/metrics/metrics.service.ts) | Registry, HTTP counters/histogram, business gauges computed at scrape |
| [metrics/http-metrics.interceptor.ts](../../apps/api/src/metrics/http-metrics.interceptor.ts) | Global interceptor timing every request |
| [metrics/metrics.controller.ts](../../apps/api/src/metrics/metrics.controller.ts) | `GET /v1/metrics` with its own bearer token |
| [health.controller.ts](../../apps/api/src/health.controller.ts) | `GET /v1/health/live`, `GET /v1/health/ready` |
| [main.ts#L15](../../apps/api/src/main.ts#L15) | Fastify logger with header redaction |
| [deploy/monitoring/alert-rules.yaml](../../deploy/monitoring/alert-rules.yaml) | Prometheus alerts matching the runbooks |

## Read in this order

1. [Metrics](metrics.md): what's measured, cardinality, scrape protection, alerts.
2. [Health, readiness and logs](health-and-logs.md): probe semantics, production safety, correlation IDs, log redaction.

## 30-second answer

> A global Nest interceptor records request count and duration labelled by method, **route template** and status, never raw URLs or IDs, so cardinality stays bounded and no personal data leaks into metrics. Business gauges (outbox backlog, dead letters, communications by status, pending scans and their oldest age, open tickets by SLA state, audit-chain validity and runtime-role safety) are computed from PostgreSQL at scrape time. `/metrics` is disabled unless a token is set and compares it in constant time. Liveness doesn't check dependencies; readiness runs `SELECT 1`; unsafe production configuration stops startup. Logs redact Authorization and Cookie headers, and correlation IDs tie logs, audit and events together.

## Q&A

**Why route templates as labels?** `/tickets/:ticketId` is one series; `/tickets/4f1c…` per ticket would create millions of series (a "cardinality explosion") and leak IDs.

**Why compute business gauges at scrape time?** They're always consistent with the database, there's no in-memory counter to drift, and they work across instances.

**Why a separate metrics token instead of OIDC?** Prometheus is a machine without a user login; a static bearer token plus network restrictions is standard. Constant-time comparison avoids timing leaks.

**Why doesn't liveness check the DB?** If the DB is down, restarting healthy API pods won't help and causes a restart storm. Readiness takes the pod out of traffic instead.

Related: [Operations runbooks](../operations/runbooks.md) · [Production readiness](../operations/production-readiness.md) · [Audit integrity metrics](../audit/integrity-and-anchors.md#7-status-anchors-api-and-metrics) · [API bootstrap](../api-bootstrap/README.md)
