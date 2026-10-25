# Application composition and bootstrap

This is the missing top-level module: how Nest, Fastify and all feature modules become one running API.

## `AppModule` import graph

[`AppModule`](../../apps/api/src/app.module.ts) is the root dependency graph. It imports all 21 feature/infrastructure modules and registers `HealthController`. It also installs `DeniedAuthorizationInterceptor` under the `APP_INTERCEPTOR` token, making denial evidence cross-cutting rather than dependent on every controller remembering an annotation.

Several imported modules are global (`Database`, `Cache`, `Storage`, `Audit`, `Outbox`, `Live`, `Notifications`, `Compliance`, `Workflow`). Global means their exported providers are available throughout Nest's graph; it does not mean their HTTP routes are public. Other modules import their explicit dependencies to keep ownership visible.

Nest resolves this graph at startup, instantiates singleton-scoped providers and calls lifecycle hooks such as database-role checks, storage initialization, LISTEN connection setup and optional worker/scheduler startup. If a constructor dependency is not exported/imported correctly, application creation fails before serving requests.

## Bootstrap order

[`main.ts`](../../apps/api/src/main.ts) performs:

1. Load reflection metadata and environment variables.
2. Call `assertProductionSafety()` before creating/listening.
3. Create `NestFastifyApplication` using `FastifyAdapter`.
4. Configure Fastify logger redaction for authorization/cookie headers, request body limit and optional trusted proxy behavior.
5. Register Helmet response headers.
6. Register global rate limiting and exclude liveness, metrics and the long-lived SSE stream.
7. Install request `AsyncLocalStorage` and the empty-JSON body parser.
8. Add global `/v1` prefix.
9. Configure exact CORS origins, methods, allowed/exposed headers and preflight age.
10. Install the global `ValidationPipe` with transformation, allowlisting and rejection of extra properties.
11. Listen on configured port at `0.0.0.0`.

Order matters. Request context must exist before guards write token facts; global validation must run before controllers receive DTOs; safety checks must occur before the process becomes ready.

## Fastify security configuration

The API returns JSON, so Helmet sets an extremely restrictive content security policy (`default-src 'none'`, no framing), HSTS for one year and no referrer. Authorization and cookies are redacted from framework logs.

The global body limit defaults to 1 MiB because file bytes bypass the API and go through presigned object-store URLs. CORS is disabled unless explicit origins are configured; credentials are enabled only for those origins. Allowed custom headers match actual protocols: idempotency, correlation and upload capability.

The default rate limit is 600 requests per minute per client. Trusting proxy-derived client IP is an explicit deployment setting because enabling it behind an untrusted network lets callers spoof rate-limit/audit source IP.

## Request lifecycle in this application

```text
Fastify request hook / request context
  -> Helmet/CORS/rate limit/body parsing
  -> Nest global metrics + denial interceptors
  -> route AuthGuard or PortalAuthGuard
  -> global ValidationPipe for params/query/body DTOs
  -> controller
  -> service policy and transaction
  -> response / interceptor completion
```

Interceptors wrap execution: metrics observes success/error, and the denial interceptor can record a thrown 403. An authentication failure occurs before a trusted actor exists; a service authorization failure occurs after `request.user` and correlation id exist.

## Frontend relationship

The staff and portal applications read their API base URL from runtime configuration and call paths under `/v1`. They never rely on same-origin behavior being implicitly open: production CORS must list their exact origins. The API exposes `X-Next-Cursor` because the staff ticket list reads it from a response header.

## Tests and interview answer

An unauthenticated E2E test proves real module/guard wiring. Production-safety tests prove pre-listen refusal. Build/typecheck proves provider imports and TypeScript types, while an application-start smoke test should verify lifecycle hooks and `/v1/health/*`.

> I compose the API through one root `AppModule` and bootstrap it on Fastify. Before listen, production-safety checks run. Bootstrap installs redacted logging, Helmet, rate limits, request audit context, strict CORS, a `/v1` prefix and a global whitelist/forbid validation pipe. The root global interceptor records authorization denials, while feature modules own business providers. This makes the security and request pipeline application-wide rather than repeated per route.
