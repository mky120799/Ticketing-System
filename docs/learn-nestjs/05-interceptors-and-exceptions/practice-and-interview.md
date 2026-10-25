# Lesson 5 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Predict what is observed

| Failure | Does a handler interceptor see it? | Why |
|---|---|---|
| missing token rejected by guard | no | guards run before interceptors |
| invalid DTO rejected by pipe | yes | interceptor entered before pipes |
| service throws 403 | yes | error flows back through observable |
| malformed JSON rejected by Fastify | no | parsing happens before Nest handler pipeline |
| successful controller return | yes | `tap.next` observes completion/value |

## 2. Find the bug: swallowed exception

```ts
return next.handle().pipe(
  catchError((error) => {
    this.logger.warn(error);
    return of({ ok: false });
  }),
);
```

This converts every failure into a successful response value. If observation is the goal, return `throwError(() => error)` after safe logging. If mapping is intended, map only known exceptions into a documented response.

## 3. Find the bug: metric cardinality

```ts
httpRequests.inc({ route: request.url });
```

Concrete URLs may contain millions of UUIDs/query combinations. Use the route template such as `/tickets/:ticketId`, omit query strings and keep labels bounded.

## 4. Design drill: audit failure behavior

Compare:

- successful ticket mutation: business row and audit event should use one transaction; audit failure rolls back the mutation;
- denied authorization: no business success exists to commit; a separate best-effort audit transaction records denial, but audit failure should not turn 403 into 500;
- authentication failure: occurs before interceptors; record carefully at the guard/edge if required, avoiding token storage.

These are three different consistency decisions, not one generic “audit in an interceptor” pattern.

## 5. Interview answer at three depths

### 30 seconds

> I use DI-registered global interceptors for cross-cutting HTTP metrics and denied-authorization evidence. Interceptors wrap the handler observable, so they can start work before pipes/controllers and observe success or error afterward. They preserve the original response, use low-cardinality route labels and never replace business transaction auditing.

### Two minutes

> `HttpMetricsInterceptor` starts a Prometheus duration timer using method and route template, then uses `tap` to record status on success or error. `DeniedAuthorizationInterceptor` uses `catchError` to select authenticated 403s, writes an `authorization.denied` event in a separate transaction, then rethrows the original exception; if that audit write fails, it still preserves the original 403. Guards run before interceptors, so missing-token 401s are outside this path. Nest's built-in exception layer serializes thrown HTTP exceptions, including structured codes such as stale state or step-up required, which the React client can handle without matching message text.

### Code-level follow-up

Write:

```ts
intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
  const started = performance.now();
  return next.handle().pipe(
    tap({
      next: () => record('success', performance.now() - started),
      error: (error) => record(statusOf(error), performance.now() - started),
    }),
  );
}
```

Explain that `tap` observes rather than transforms and that guard/Fastify failures happen outside this wrapper.

## 6. Follow-up questions

1. **Interceptor vs middleware?** Middleware runs earlier and is adapter/request oriented; interceptors understand Nest execution context and wrap handler results.
2. **Interceptor vs exception filter?** An interceptor can observe/transform both success and error around a handler; a filter handles an exception at the final response boundary.
3. **Can an interceptor modify output?** Yes, with operators such as `map`, but response contracts must stay explicit.
4. **Why use `APP_INTERCEPTOR`?** It creates a global interceptor through Nest DI, allowing constructor-injected providers.
5. **Why not include ticket id in a metric label?** Unbounded cardinality harms storage and query performance and may expose identifiers.
6. **What if denial audit fails?** The implementation deliberately rethrows the original 403; operations should alert on audit-write failure separately.

## 7. Hands-on exercise

Design a correlation-response interceptor that adds `X-Correlation-Id` from trusted request context on both success and error. Decide whether an interceptor is early enough for guard failures. If not, explain which Fastify hook/filter combination would be required for universal coverage.

## 8. Self-assessment

You are ready when you can draw the nested observable, predict which failures reach it, preserve original exceptions through async side effects, and justify metric/audit failure semantics.
