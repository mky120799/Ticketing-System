# Lesson 5 code walkthrough: wrapping success and failure

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

Interceptors run before a handler and receive its future result as an RxJS `Observable`. This makes them suitable for cross-cutting behavior that needs both request context and the eventual success/error.

## 1. Global registration by provider token

The project registers global interceptors with `APP_INTERCEPTOR`:

```ts
providers: [
  { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
]
```

and at the root:

```ts
providers: [
  { provide: APP_INTERCEPTOR, useClass: DeniedAuthorizationInterceptor },
]
```

This is dependency-injection-aware global registration: Nest creates each interceptor and injects its services. `app.useGlobalInterceptors(new X())` can be useful, but manually constructing an interceptor makes injected dependencies awkward.

When several global interceptors exist, reason about them as nested wrappers. Avoid correctness that depends on accidental registration order unless the order is explicitly tested and documented.

## 2. Metrics interceptor: before and after

Simplified:

```ts
intercept(context: ExecutionContext, next: CallHandler) {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  const route = request.routeOptions?.url ?? 'unknown';
  const end = this.metrics.httpDuration.startTimer({
    method: request.method,
    route,
  });

  return next.handle().pipe(tap({
    next: () => done(reply.statusCode),
    error: (error) => done(error.getStatus?.() ?? 500),
  }));
}
```

`startTimer` is the before phase. `tap` observes terminal success/error without replacing the value. The route template is used rather than the concrete URL so metrics do not create one high-cardinality label per ticket UUID.

The interceptor runs after guards, so it does not measure requests rejected by guards. Fastify-level metrics would be needed for absolutely every incoming request.

## 3. Denied-authorization interceptor: preserve the original error

The interceptor catches errors flowing back from pipes/controllers/services:

```ts
return next.handle().pipe(
  catchError((error) => {
    const status = getStatus(error);
    if (status !== 403 || !request.user || !request.correlationId) {
      return throwError(() => error);
    }

    return from(writeDeniedAudit()).pipe(
      mergeMap(() => throwError(() => error)),
      catchError(() => throwError(() => error)),
    );
  }),
);
```

Important behavior:

1. Only authenticated 403 failures are selected.
2. It creates a separate transaction for an `authorization.denied` audit event because the rejected business transaction may already have rolled back.
3. It rethrows the original exception so the caller still gets the intended 403.
4. If denial auditing itself fails, the caller still gets the original 403 rather than a misleading 500.

This is an explicit availability trade-off: denial evidence is best-effort, while successful business audit events are written atomically in the business transaction.

## 4. Why guard failures are different

Guards run before interceptors. A 401 thrown by `AuthGuard` never enters these handler interceptors. Therefore `DeniedAuthorizationInterceptor` cannot audit invalid/missing tokens. If authentication failure telemetry is required, implement it in the guard or a Fastify hook with careful privacy/rate controls.

## 5. Observable operators used here

You do not need all RxJS to read Nest interceptors:

| Operator/function | Purpose here |
|---|---|
| `next.handle()` | continue into pipes/controller/service and represent the future result |
| `tap` | observe success/error without changing them |
| `catchError` | replace or rethrow an error path |
| `from(promise)` | adapt an async audit write into the stream |
| `mergeMap` | after async work, return the original error observable |
| `throwError` | emit an error rather than a successful value |

If `catchError` accidentally returns a normal value, it converts a failure into success. If it throws a new generic error, it can destroy the original status and structured code.

## 6. Exception categories and response contracts

Nest `HttpException` subclasses carry status plus response data:

```ts
throw new ConflictException({
  statusCode: 409,
  error: 'Conflict',
  code: 'stale_ticket',
  message: 'The ticket changed. Reload and try again.',
});
```

The frontend should branch on a stable `code`, not exact English text. Typical meanings:

| Status | Meaning in this project |
|---|---|
| 400 | malformed/invalid request boundary |
| 401 | identity absent or unusable |
| 403 | authenticated but denied, including step-up requirement |
| 404 | absent or intentionally hidden resource |
| 409 | state/idempotency/concurrency conflict |
| 422 | syntactically valid but semantically unprocessable, if used |
| 500 | unexpected defect or dependency failure not intentionally mapped |

## 7. Built-in filter vs custom filter

The application relies primarily on Nest's built-in HTTP exception handling. A custom filter is justified when the entire API needs one stable envelope, correlation id injection or controlled logging. It must preserve security-sensitive hiding rules and avoid leaking raw SQL/stack traces.

An exception filter is the final error-to-response adapter. It is not the place to implement normal business policy or transaction rollback logic.

## 8. Frontend error path

The staff API client parses non-2xx JSON into a normalized error. UI code can then distinguish:

- 401: session recovery/sign-in;
- `step_up_required`: reauthenticate with stronger/recent context;
- `stale_ticket`: warn, refetch and preserve user intent;
- 403: explain lack of access without retrying blindly;
- 409: refresh relevant state;
- 5xx/network: retry only idempotent/safe operations according to policy.

Do not show raw backend error objects or stack traces to users.

## 9. Review checklist

- Interceptor has one cross-cutting responsibility.
- Request labels are bounded; no user ids/ticket ids in metrics labels.
- Success value is not accidentally transformed.
- Original status/code survives observation.
- Async side work has an explicit failure policy.
- No secrets or sensitive payloads enter logs/metrics.
- Guard failures are not incorrectly assumed to pass through interceptors.
- Business mutations and their success audit remain atomic in services.
