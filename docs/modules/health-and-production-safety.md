# Health, readiness and production safety

Health endpoints answer orchestration questions; production safety prevents a badly configured process from ever becoming healthy.

## Liveness and readiness

[`HealthController`](../../apps/api/src/health.controller.ts) is registered directly by `AppModule`:

- `GET /v1/health/live` returns `{ status: 'ok' }` without checking dependencies. It answers “is the event loop/process serving HTTP?” A database outage should not force an endless process restart loop.
- `GET /v1/health/ready` executes `SELECT 1` and returns database reachability. Failure makes the request fail, telling the load balancer not to route business traffic to this instance.

These routes do not use staff OIDC and are excluded from the application rate limiter. They must reveal no version, environment, credentials or schema information. Network/platform policy may still limit access.

Readiness currently checks only PostgreSQL. Optional Redis, Kafka, S3, ClamAV and email providers are deliberately not hard readiness dependencies because the application can queue/retry or disable those features. If a deployment requires them, use separate operational indicators rather than turning every transient provider incident into total API unavailability.

## Production safety gate

[`assertProductionSafety`](../../apps/api/src/production-safety.ts) runs before `NestFactory.create`. In production it checks for unsafe combinations such as development identity issuers/settings, missing client restrictions, unsuitable database configuration and audit-role requirements. A failure throws before the port is opened.

This is different from readiness:

- safety gate: configuration is known to violate a security invariant; terminate and require operator correction;
- readiness: a normally valid dependency is temporarily unavailable; keep process alive but remove it from traffic;
- liveness: process is wedged/dead; restart it.

## Kubernetes/deployment interpretation

The liveness probe targets `/v1/health/live`; readiness targets `/v1/health/ready`. Give startup/migration time before aggressive liveness checks. Schema migrations should run separately under the owner role; the application should become ready only after migrations and restricted-role access are available.

Prometheus `/v1/metrics` is not a health check. It is token-protected and can execute multiple gauge queries. Likewise, SSE is long-lived and excluded from generic rate limiting but should not be used as a probe.

## Failure cases and tests

- Process running, DB down: live succeeds, ready fails.
- Unsafe production environment: process exits before either endpoint is available.
- Optional Redis unavailable: ready remains healthy because cache falls back.
- Outbox/Kafka unavailable: API can remain ready; backlog/retry metrics alert operators.
- Audit runtime role unsafe with required flag: database guard/safety startup fails.

> I separate liveness, readiness and configuration safety. Liveness is dependency-free; readiness checks PostgreSQL because every business request needs it. Optional providers expose backlog/health metrics rather than taking the whole API out of traffic. Security configuration is checked before Nest listens, so an unsafe production deployment fails fast instead of reporting healthy.
