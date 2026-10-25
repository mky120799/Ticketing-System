# Learn NestJS with this project

This is a code-first NestJS course built around the running bank case platform. It does not stop at decorator definitions. Every lesson explains the runtime behavior, points to exact repository files, traces a request or worker through the code, gives failure scenarios to debug, and finishes with an interview drill.

Authentication, authorization and audit remain separate implementation tracks because each is large enough to study independently. The guard lesson teaches the Nest boundary and then links to those tracks instead of mixing all security internals into one chapter.

## How the course is organized

Each lesson now has its own folder:

- `README.md` is the complete concept chapter.
- `code-walkthrough.md` follows repository code and explains why each boundary exists.
- `practice-and-interview.md` contains debugging exercises, implementation questions and answer structures.
- Lesson 10 has separate backend and frontend code labs because a production feature crosses both applications.

Read the concept chapter once, perform the code trace with the editor open, then answer the interview questions without looking at the notes.

## Course map

| # | Lesson | Core chapter | Code-level follow-up | What you must be able to explain |
|---|---|---|---|---|
| 1 | Modules, providers and DI | [Chapter](01-modules-and-di/README.md) | [Code trace](01-modules-and-di/code-walkthrough.md) · [Practice](01-modules-and-di/practice-and-interview.md) | How Nest builds the provider graph and why imports/exports matter |
| 2 | Controllers and routing | [Chapter](02-controllers-and-routing/README.md) | [Code trace](02-controllers-and-routing/code-walkthrough.md) · [Practice](02-controllers-and-routing/practice-and-interview.md) | How an HTTP request becomes a controller method call |
| 3 | DTOs and validation | [Chapter](03-dtos-and-validation/README.md) | [Code trace](03-dtos-and-validation/code-walkthrough.md) · [Practice](03-dtos-and-validation/practice-and-interview.md) | Runtime validation, transformation, nested DTOs and safe error boundaries |
| 4 | Guards and request identity | [Chapter](04-guards/README.md) | [Code trace](04-guards/code-walkthrough.md) · [Practice](04-guards/practice-and-interview.md) | Where identity is established and why resource policy stays in services |
| 5 | Interceptors and exceptions | [Chapter](05-interceptors-and-exceptions/README.md) | [Code trace](05-interceptors-and-exceptions/code-walkthrough.md) · [Practice](05-interceptors-and-exceptions/practice-and-interview.md) | Before/after behavior, RxJS error paths and stable HTTP failures |
| 6 | Request lifecycle | [Chapter](06-request-lifecycle/README.md) | [Code trace](06-request-lifecycle/code-walkthrough.md) · [Practice](06-request-lifecycle/practice-and-interview.md) | The exact order from Fastify parsing to response serialization |
| 7 | Lifecycle hooks and workers | [Chapter](07-lifecycle-hooks-and-workers/README.md) | [Code trace](07-lifecycle-hooks-and-workers/code-walkthrough.md) · [Practice](07-lifecycle-hooks-and-workers/practice-and-interview.md) | Startup/shutdown, polling loops, claims, retries and multi-instance safety |
| 8 | Custom providers and configuration | [Chapter](08-custom-providers-and-configuration/README.md) | [Code trace](08-custom-providers-and-configuration/code-walkthrough.md) · [Practice](08-custom-providers-and-configuration/practice-and-interview.md) | Tokens, factories, global modules and fail-safe configuration |
| 9 | Testing NestJS | [Chapter](09-testing/README.md) | [Code trace](09-testing/code-walkthrough.md) · [Practice](09-testing/practice-and-interview.md) | Unit vs E2E vs integration proof and how to test refusal paths |
| 10 | Build a complete feature | [Chapter](10-build-a-feature/README.md) | [Backend lab](10-build-a-feature/backend-code-lab.md) · [Frontend lab](10-build-a-feature/frontend-code-lab.md) · [Delivery drill](10-build-a-feature/practice-and-interview.md) | Contract-to-database-to-React implementation and how to narrate it |

## What “complete” means

After Lesson 10, you should be able to explain and implement all of these without relying on framework slogans:

1. Start from `main.ts` and explain Fastify creation, the global prefix, CORS, security plugins and validation.
2. Start from `AppModule`, resolve where a constructor dependency comes from and diagnose a missing provider.
3. Take a URL and identify its controller, route metadata, extracted inputs, DTO and service call.
4. Explain why TypeScript types do not validate JSON and how decorator metadata reaches `ValidationPipe` at runtime.
5. Explain how a verified token becomes `request.user`, then distinguish authentication from resource authorization.
6. Predict whether a failure is produced by the adapter, guard, pipe, service, interceptor or exception layer.
7. Build a worker that starts safely, avoids overlapping polls, coordinates across instances and shuts down cleanly.
8. Replace an external integration in a test by overriding a symbol-token provider.
9. Choose the smallest honest test level and state what that test still does not prove.
10. Implement a vertical feature through migration, DTO, controller, service transaction, audit/outbox, React Query mutation and tests.

## Separate security and evidence tracks

Do these after Lesson 6, or in parallel if security is your interview priority.

### Authentication

Read [Authentication overview](../modules/authentication/README.md), [backend code walkthrough](../modules/authentication/backend.md), [browser session implementation](../frontend/authentication-and-session.md), [hardening](../modules/authentication/hardening.md) and [tests](../modules/authentication/testing.md).

You should be able to trace:

```text
browser redirect -> authorization code + PKCE -> access token
-> Authorization header -> AuthGuard -> signature/claim/revocation checks
-> UserContext -> controller -> service
```

### Authorization

Read [Authorization](../modules/authorization.md) and [roles and access](../security/roles-and-access.md). Be ready to explain permission checks, queue/branch/entity scope, sensitivity, service identities, maker-checker separation and why hiding a frontend button is not authorization.

### Audit

Read [Audit overview](../modules/audit/README.md), [event and transaction model](../modules/audit/event-model.md), [integrity and operations](../modules/audit/integrity-and-operations.md), [frontend](../modules/audit/frontend.md) and [testing](../modules/audit/testing.md).

You should be able to trace a business mutation and its evidence in the same transaction, then explain append-only database privileges, hash verification, archival and export step-up.

## Frontend bridge

NestJS does not end at the controller response. Use the frontend track to see how API decisions reach users:

1. [Staff app bootstrap and routing](../frontend/staff-console-bootstrap-and-routing.md)
2. [Authentication and session](../frontend/authentication-and-session.md)
3. [Typed API client and normalized errors](../frontend/api-data-flow.md)
4. [Ticket list and React Query](../frontend/ticket-list-and-react-query.md)
5. [Ticket workspace](../frontend/ticket-workspace.md)
6. [Customer portal](../frontend/customer-portal.md)

The backend remains authoritative. Frontend route and capability checks improve usability; every API request still rechecks identity, permission, scope and current resource state.

## How to study one lesson

Use a 60–90 minute loop:

1. Read the core chapter and write the runtime sequence in your own words.
2. Open every file in the code trace. Follow imports and constructor dependencies rather than reading isolated snippets.
3. Run or inspect the stated test. Identify exactly which boundary it proves.
4. Complete one debugging exercise before reading the answer.
5. Give the 30-second answer, then the two-minute answer, then the code-level answer aloud.
6. Add one limitation. Strong interview answers distinguish implemented guarantees from desired improvements.

## Interview answer framework

When asked “How did you implement it?”, use this order:

```text
Requirement
  -> entry point
  -> Nest boundary (module/controller/guard/pipe)
  -> service decision
  -> transaction and persistence
  -> audit/outbox/live propagation
  -> frontend cache and error behavior
  -> tests and known limitation
```

Example opening:

> I exposed the operation through a controller route with a validated DTO. The guard verifies the bearer token and attaches a normalized user context. The service loads the resource, applies permission and scope policy, and performs the state change plus audit/outbox writes in one PostgreSQL transaction. The React Query mutation invalidates the authoritative server query after success and maps structured API errors for stale or forbidden actions. Unit tests prove policy branches, E2E tests prove the HTTP boundary, and integration tests prove transaction and constraint behavior.

That opening is only the map. The lesson drills teach you how to name the actual classes, methods, SQL constraints and failure paths behind it.

## Repository files to keep open

- `apps/api/src/main.ts` and `apps/api/src/app.module.ts`
- `apps/api/src/tickets/tickets.module.ts`
- `apps/api/src/tickets/tickets.controller.ts`
- `apps/api/src/tickets/ticket.dto.ts`
- `apps/api/src/tickets/tickets.service.ts`
- `apps/api/src/auth/auth.guard.ts` and `apps/api/src/auth/policy.service.ts`
- `apps/api/src/audit/audit.service.ts`
- `apps/web/src/api.ts` and `apps/web/src/features/tickets/use-ticket-queries.ts`
- `apps/api/test/unauthenticated.e2e-spec.ts` and `apps/api/test/ticket.integration-spec.ts`

## Course verification checklist

Mark the course complete only when you can do all of the following from a blank page:

- Draw the module/provider graph for `TicketsModule`.
- Derive `POST /v1/tickets/:ticketId/notes` from its decorators.
- Write a DTO with nested validation and explain every decorator.
- Explain a 401, 403, 404, 409 and 422 from boundary to response.
- Put guard, interceptor, pipe, controller and exception behavior in the correct order.
- Sketch a skip-locked worker claim and explain at-least-once delivery.
- Bind and override a symbol-token provider.
- Write one unit, one E2E and one database integration test for the same feature.
- Add a React Query mutation with error handling and targeted invalidation.
- Give a code-level implementation answer that includes one real limitation.

Continue to the [complete application module index](../modules/README.md) or the [end-to-end flow index](../flows/README.md).
