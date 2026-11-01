# Metrics

[Back to Observability index](README.md) · Code: [metrics.service.ts](../../apps/api/src/metrics/metrics.service.ts)

---

## 1. Wiring

[metrics.module.ts](../../apps/api/src/metrics/metrics.module.ts): `MetricsService`, `MetricsController`, and `{ provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }`, a **global interceptor**, so every route is measured without decorators.

## 2. HTTP metrics

[http-metrics.interceptor.ts#L9-L14](../../apps/api/src/metrics/http-metrics.interceptor.ts#L9-L14):

```ts
const route = request.routeOptions?.url ?? 'unknown';                     // '/v1/tickets/:ticketId', not the real URL
const end = this.metrics.httpDuration.startTimer({ method, route });
return next.handle().pipe(tap({
  next: () => done(reply.statusCode),
  error: (error) => done(error.getStatus?.() ?? 500)                       // errors are counted with their status
}));
```

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | Counter | method, route, status |
| `http_request_duration_seconds` | Histogram (buckets 10 ms … 5 s) | method, route |

**Counter** = only goes up (use `rate()`). **Histogram** = counts per latency bucket (use `histogram_quantile(0.99, ...)` for p99).

Guard 401s happen **before** interceptors, so they aren't in these metrics. Edge or gateway metrics should count authentication failures.

## 3. Business gauges (computed at scrape)

[render, L40-L55](../../apps/api/src/metrics/metrics.service.ts#L40-L55):

| Gauge | Meaning | Alert idea |
|---|---|---|
| `outbox_events{status}` | pending, in_flight, retry, dead_letter counts | `dead_letter > 0`; pending growing |
| `tickets_open{sla_status}` | open tickets per SLA state | breached > 0 |
| `communications{status}` | messages per delivery state | queued not draining; failed > 0 |
| `attachments_pending_scan` / `attachments_oldest_pending_scan_seconds` | scan backlog and its age | oldest > 15 min: scanner down |
| `live_event_streams` | SSE connections on this instance | capacity |
| `audit_chain_valid` (1/0), `audit_chain_verified_sequence`, `audit_chain_last_verified_timestamp_seconds` | integrity status | invalid, or no verification for 3 h |
| `audit_runtime_role_safe` (1/0) | app DB role can't tamper | unsafe |
| Node defaults (`collectDefaultMetrics`) | heap, event loop lag, GC | |

A **gauge** is a value that goes up and down. Labels come only from fixed status enums, never from request data ([comment L8-L11](../../apps/api/src/metrics/metrics.service.ts#L8-L11)).

## 4. Scrape protection

[metrics.controller.ts#L11-L19](../../apps/api/src/metrics/metrics.controller.ts#L11-L19):

```ts
const token = process.env.METRICS_TOKEN;
if (!token) throw new NotFoundException();                                    // disabled → looks like it doesn't exist
const presented = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
```

Also `Cache-Control: no-store`, excluded from rate limiting ([main.ts#L18](../../apps/api/src/main.ts#L18)). Production should add a network policy as well. Test: [workflow.integration-spec.ts#L174](../../apps/api/test/workflow.integration-spec.ts#L174) ("exposes metrics only to a holder of the metrics token").

## 5. Alerts

[deploy/monitoring/alert-rules.yaml](../../deploy/monitoring/alert-rules.yaml), with the same copy in the Helm chart:

| Alert | Expression (short) |
|---|---|
| AuditChainInvalid | `audit_chain_valid == 0` |
| AuditVerificationStale | last verified > 3 h ago |
| AuditRuntimeRoleUnsafe | `audit_runtime_role_safe == 0` |
| DeadLetteredEvents | `outbox_events{status="dead_letter"} > 0` |
| OutboxBacklogGrowing | pending growing and > 100 |
| CustomerMessagesNotSending / Failing | queued not shrinking / failed > 0 |
| AttachmentScansStuck | oldest pending scan > 900 s |
| ApiErrorRateHigh | 5xx > 1 % over 5 min |
| ApiLatencyHigh | p99 > 2 s |
| ApiDown | target `up == 0` |
| ComplaintsPastFinalResponse | `tickets_open{sla_status="breached"} > 0` |

Each maps to a section of [operations/runbooks.md](../operations/runbooks.md).
