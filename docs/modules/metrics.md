# Metrics module

Metrics exposes low-cardinality Prometheus telemetry for HTTP behavior and operational queues. It deliberately excludes customer identifiers, ticket ids, free text and raw URLs.

## Wiring and scrape protection

[`MetricsModule`](../../apps/api/src/metrics/metrics.module.ts) registers `MetricsService`, `MetricsController` and [`HttpMetricsInterceptor`](../../apps/api/src/metrics/http-metrics.interceptor.ts) as an `APP_INTERCEPTOR`, so it observes all Nest routes.

`GET /metrics` is outside user OIDC because Prometheus is a machine scraper. If `METRICS_TOKEN` is unset the route returns `404`; if set, it requires a bearer token compared with `timingSafeEqual`. The response is Prometheus text with `Cache-Control: no-store`. Production should also restrict this endpoint at the network layer.

## Instrumentation design

The interceptor labels HTTP count/duration with method, Nest route template and status. It uses `request.routeOptions.url`, such as `/tickets/:ticketId`, never the concrete URL. That avoids personal-data leakage and an unbounded time series for each UUID.

[`MetricsService`](../../apps/api/src/metrics/metrics.service.ts) registers Node default metrics plus:

- outbox rows by bounded status;
- open tickets by SLA status;
- communication rows by delivery status;
- attachments pending scan and age of the oldest;
- connected SSE streams on this instance;
- audit-chain validity, verified sequence and last verification time;
- whether the runtime database role is safe for immutable audit.

Business gauges are queried at scrape time, so they reflect PostgreSQL source-of-truth state. Gauge label values come from controlled enums/statuses, not request data.

## Frontend and operational use

There is no product frontend for `/metrics`; Prometheus scrapes it and dashboards/alerts visualize trends. The application admin screen uses authenticated Operations APIs instead. Useful alerts include growing dead letters, an old pending scan, invalid audit chain, unsafe runtime DB role, high 5xx rate and saturated latency buckets.

## Tests and interview answer

Test disabled-route `404`, bad/good token, route-template labels, error status observation, no raw UUID labels and gauge values from seeded rows. Also verify metrics failure cannot expose database errors or secrets.

> I instrumented Nest globally with an interceptor that records method, route template and status, so cardinality stays bounded. Prometheus uses a separate constant-time bearer token and network controls, not a staff session. Operational gauges are calculated from PostgreSQL at scrape time and labels are controlled enums. We never put ticket ids, customer references or free text in metrics.
