# Lesson 6 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Put the layers in order

Arrange these without looking:

```text
Fastify parsing/edge hooks
-> Nest routing
-> middleware
-> guards
-> interceptors before
-> pipes
-> controller
-> service
-> interceptors after/error
-> exception filter on failure
-> adapter response
```

Remember that several global/controller/method guards or interceptors have their own ordering rules; the sequence above is the layer order.

## 2. Earliest-rejection matrix

| Scenario | Earliest layer with enough information | Expected status |
|---|---|---|
| 2 MB body with limit 1 MB | Fastify body limit | 413 |
| malformed JSON | body parser | 400 |
| unmatched URL | router | 404 |
| missing bearer token | guard | 401 |
| unknown DTO field | global pipe | 400 |
| user lacks permission | service policy | 403 |
| ticket no longer visible | service lookup/policy | safe 404 or 403 by contract |
| stale expected timestamp | service/database concurrency check | 409 |
| duplicate unique key race | database constraint mapped by service | 409 |

## 3. Explain a surprising response

Question: “Why did my invalid JSON request return 400 instead of 401 even though I was unauthenticated?”

Answer: Fastify must parse the body before Nest's guard can execute. Broken JSON fails at the adapter/parser boundary. In contrast, valid JSON with invalid DTO fields and no token reaches the guard first and returns 401 before the pipe.

## 4. Interview answer at three depths

### 30 seconds

> Requests first pass Fastify concerns such as size, parsing, rate limits and request context. Nest then routes and runs guards, interceptors before, pipes, controller and service. Results/errors flow back through interceptors, and exceptions are serialized at the final filter layer. Each check lives at the earliest layer that has enough information.

### Two minutes

> On a ticket mutation, Fastify first enforces body limits and parses JSON, and an on-request hook starts audit context. Nest matches the `/v1` route, then `AuthGuard` verifies the bearer token and attaches `UserContext`. Global interceptors enter, the global `ValidationPipe` transforms and validates the DTO, and the controller maps path/body/context into a service call. The service loads the ticket, runs policy and executes an explicit PostgreSQL transaction containing business and evidence writes. On return, interceptors record low-cardinality metrics; on a 403, the denial interceptor attempts separate evidence and rethrows. Nest's exception layer turns known exceptions into stable JSON. React handles status/code and refetches authoritative data after relevant success or conflict.

### Code-level follow-up

Use one real route and name every class/method, not just layer names. For example:

```text
TicketsController.addNote
-> AddNoteDto / ValidationPipe
-> TicketsService.addNote
-> PolicyService.assertTicketAccess
-> PgService.transaction
-> AuditService.write
```

Then add the frontend mutation and query invalidation.

## 5. Follow-up questions

1. **Does Nest create a transaction for every request?** No; services explicitly define transaction boundaries.
2. **Can an interceptor see a guard rejection?** No, the guard runs first.
3. **Can an interceptor see a pipe rejection?** Yes, it has already entered around `next.handle()`.
4. **Where does malformed JSON fail?** In the HTTP adapter/body parser, before guards.
5. **Why validate before the controller?** The handler receives a checked boundary object and never starts business work for malformed input.
6. **What rolls back a transaction?** The explicit transaction helper catches a rejected/thrown callback and rolls back; Nest itself does not.
7. **Why does the UI refetch after a live event?** The event is a hint; the API remains the authorized source of truth.

## 6. Incident drill

Symptom: users receive 500 after a database timeout, but latency metrics show nothing.

Investigate in order:

1. Did the request enter `HttpMetricsInterceptor`, or fail in Fastify/guard first?
2. Is the route template available, or labeled `unknown`?
3. Did a long-running dependency reject after the timer began?
4. Did logging redact authorization/cookies and include a correlation id?
5. Did the transaction roll back, and are its queries all using the same client?
6. Is a custom filter/interceptor replacing the original error?

## 7. Hands-on exercise

Trace `POST /v1/tickets/:ticketId/communications` in two cases:

- successful approved/direct send path;
- valid DTO but communication blocked by current ticket state.

For each, list controller, DTO, policy, transaction writes, audit/outbox effects, worker continuation and frontend convergence. Use the module and flow docs when the course chapter no longer has enough domain detail.

## 8. Self-assessment

You are ready when you can predict the first response for combinations of malformed transport, missing identity, invalid DTO, forbidden resource and stale state—and explain which downstream code never ran.
