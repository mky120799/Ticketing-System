# Lesson 6 code walkthrough: one request, every layer

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This walkthrough traces `POST /v1/tickets/:ticketId/notes` and shows where five different failures stop it.

## 1. Process bootstrap establishes the edge

`main.ts` performs this order at startup:

1. `assertProductionSafety()` rejects unsafe production configuration.
2. `NestFactory.create` creates Nest with `FastifyAdapter`, logger redaction, body limit and proxy trust.
3. Helmet and rate-limit Fastify plugins are registered.
4. request-local audit context and empty-JSON parsing are registered.
5. `/v1`, CORS and the global `ValidationPipe` are configured.
6. the process listens on the configured host/port.

Startup order configures later request behavior. It does not mean every Fastify plugin hook has a simplistic line-by-line execution order; each plugin registers hooks for specific lifecycle phases.

## 2. Successful add-note trace

```text
HTTP bytes arrive
-> Fastify body limit and JSON parser
-> onRequest context stores IP/user-agent
-> rate/CORS/security edge behavior
-> router matches POST /v1/tickets/:ticketId/notes
-> AuthGuard verifies bearer token and writes user/correlation context
-> global interceptors enter
-> parameter/global pipes validate body/params
-> TicketsController.addNote extracts trusted/untrusted inputs
-> TicketsService.addNote loads ticket in transaction
-> PolicyService checks permission and resource scope
-> note/business/audit/outbox writes occur as designed
-> service promise resolves
-> interceptors observe success/status/duration
-> Nest/Fastify serializes JSON and response headers
```

The controller receives four important values from different trust boundaries:

| Value | Source | Trust treatment |
|---|---|---|
| ticket id | path | validate format and look up |
| note DTO | JSON body | validate shape and bound content |
| user | verified guard context | authoritative identity input to policy |
| correlation id | bounded header/generated | tracing evidence, not authority |

## 3. Five early exits

### Oversized body

Fastify rejects with 413 before token or DTO work. This is cheap resource protection.

### Broken JSON

The body parser returns 400 before Nest can construct a DTO.

### Missing token

Routing matches, then the guard throws 401. Interceptors/pipes/controller/service do not run.

### Invalid note DTO

The guard succeeds, interceptors enter, then `ValidationPipe` throws 400. Controller/service do not run; interceptors see the error.

### Out-of-scope ticket

Body and identity are valid, so the controller calls the service. After loading enough current ticket attributes, policy throws 403. The denied-authorization interceptor attempts evidence and rethrows; the exception layer writes 403.

## 4. Why 404 can be a security decision

A resource lookup can return 404 for both absent and deliberately hidden records. This reduces identifier probing. Whether a use case returns 403 or hidden 404 must be consistent and tested; the request lifecycle only explains where the exception travels, not which policy is correct.

## 5. The transaction is inside the service lifecycle

Nest does not automatically create a database transaction per request. `PgService.transaction` is called explicitly by the service. A thrown error rejects the callback and triggers rollback; after that, the error travels back through interceptors and the exception layer.

This distinction matters:

```text
Nest request scope != database transaction scope
```

Only queries using the transaction's `client` participate. Accidentally calling a pool-level helper inside the callback can commit outside the intended atomic boundary.

## 6. Async context across the call chain

The Fastify `onRequest` hook starts an `AsyncLocalStorage` context with IP and user agent. The guard enriches the same context after verifying identity. `AuditService` can read it later without adding those fields to every method signature.

Business-significant values such as actor and correlation id are still passed explicitly. Async-local state is useful for ambient request evidence, but hidden dependencies should remain limited and documented.

## 7. Response path and frontend behavior

On success, the React Query mutation receives JSON and invalidates ticket/list/dashboard queries that may now be stale. On failure, the API client normalizes status, code and message:

| Backend exit | Frontend reaction |
|---|---|
| 400 | keep form open and show field/request issue |
| 401 | recover session or redirect to sign-in |
| 403 | show denial; for `step_up_required`, reauthenticate |
| 404 | remove/refetch inaccessible resource and show safe state |
| 409 stale | warn, refetch authoritative ticket, preserve draft if possible |
| 429 | back off and avoid aggressive retries |
| 5xx/network | show retry state; never blindly replay non-idempotent writes |

## 8. Application lifecycle is a different lifecycle

Do not confuse per-request stages with provider/process hooks:

```text
process start -> module graph -> OnModuleInit -> application bootstrap -> listen
request       -> guard/interceptor/pipe/controller/service -> response
process stop  -> OnModuleDestroy/application shutdown -> clients close
```

Workers use provider lifecycle hooks, while HTTP handlers use request lifecycle stages. Lesson 7 covers the first line and shutdown.

## 9. Observability gaps to name

- handler interceptors miss Fastify parser/rate failures and guard failures;
- a correlation id currently established in the staff guard is unavailable on pre-guard failures unless the edge creates one earlier;
- 500 responses need controlled internal logging because the client must not receive raw dependency details;
- SSE and long-running responses require lifecycle/metric handling different from ordinary one-result handlers.

## 10. Trace template

For any endpoint, fill this out:

```text
edge limits/plugins:
route matched:
identity guard:
interceptors entered:
input pipes/DTO:
controller mapping:
service policy:
transaction/locks:
audit/outbox:
response/error mapping:
frontend cache/recovery:
```

This is the most reliable way to answer “what happens when the user clicks this?” without skipping a boundary.
