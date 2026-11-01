# API bootstrap: how the NestJS app starts and handles a request

> **Bootstrap**: the startup code that turns ~22 Nest modules into one running HTTP server, configuring security headers, rate limits, CORS, validation and the URL prefix.
> **Module graph**: Nest reads `@Module({ imports, providers, controllers, exports })` and builds a dependency-injection container, creating each provider once (singleton) and passing it to constructors that ask for it.
> **Request pipeline**: the fixed order every request goes through: Fastify hooks → global interceptors → guard → validation pipe → controller → service → response.

## Where it lives

| File | Role |
|---|---|
| [main.ts](../../apps/api/src/main.ts) | The bootstrap function |
| [app.module.ts](../../apps/api/src/app.module.ts) | Root module: imports all feature modules, health controller, global denied-audit interceptor |
| [production-safety.ts](../../apps/api/src/production-safety.ts) | Pre-start configuration check |
| [audit/request-context.ts](../../apps/api/src/audit/request-context.ts) | Per-request `AsyncLocalStorage`, empty-JSON body parser |
| [health.controller.ts](../../apps/api/src/health.controller.ts) | Probes |

## Read in this order

1. [Bootstrap and module graph](bootstrap-and-modules.md): `main.ts` line by line, every module and what's global.
2. [Request lifecycle](request-lifecycle.md): the pipeline order, validation, error mapping, one request traced.
3. [Interview Q&A](interview-qa.md)

Framework background: [Learn NestJS](../learn-nestjs/README.md) (lessons 1, 2, 3, 6, 7).

## 30-second answer

> `main.ts` first refuses unsafe production configuration, then creates Nest on Fastify with header-redacting logging, a 1 MiB body limit and an explicit trust-proxy setting. It registers Helmet with a JSON-only CSP and HSTS, a per-client rate limit that excludes health, metrics and SSE, a per-request `AsyncLocalStorage` for audit context, the `/v1` prefix, strict CORS from an allow-list, and a global `ValidationPipe` that whitelists, forbids unknown fields and transforms. `AppModule` composes the feature modules (infrastructure ones are global) and installs a global interceptor that audits every 403.

## Related

[Auth guard](../auth/backend-guard.md) · [Observability](../observability/README.md) · [Database](../database/README.md) · [Reference → runtime wiring map](../reference/runtime-wiring-map.md)
