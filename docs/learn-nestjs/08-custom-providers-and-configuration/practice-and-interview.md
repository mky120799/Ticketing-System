# Lesson 8 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Choose the provider form

| Requirement | Provider form |
|---|---|
| ordinary stateless service | class provider |
| fixed test clock object | `useValue` |
| select Kafka or log from configuration | `useFactory` |
| select a concrete class but let Nest build it | `useClass` |
| expose the same instance under another token | `useExisting` |
| inject interface-shaped dependency | symbol/string token plus `@Inject` |

## 2. Find the double-instance bug

```ts
providers: [
  RealClock,
  { provide: CLOCK, useClass: RealClock },
]
```

This can construct two `RealClock` instances. If the token should alias the registered one:

```ts
providers: [
  RealClock,
  { provide: CLOCK, useExisting: RealClock },
]
```

The distinction matters for stateful clients, connection pools and lifecycle cleanup.

## 3. Configuration policy drill

Classify each setting:

| Setting | Missing production behavior |
|---|---|
| OIDC issuer/audience | refuse authentication/startup configuration |
| Redis URL | cache disabled/fallback to source of truth |
| object storage for attachment feature | fail feature/startup according to deployment contract |
| Kafka brokers when Kafka selected | fail startup |
| workflow worker enabled flag | worker stays off |
| audit restricted-role requirement | should be true in production; refuse unsafe role |

The answer must include why the dependency is security/consistency critical or merely optional.

## 4. Interview answer at three depths

### 30 seconds

> I use class providers for application services and symbol tokens for interface-based adapters. Modules bind those tokens with factories that choose implementations from validated configuration. Business code receives a stable contract, tests override the token, and production-safety checks fail startup for dangerous settings.

### Two minutes

> `OUTBOX_PUBLISHER` is a symbol because `OutboxPublisher` is erased at runtime. `OutboxModule` binds it with `createOutboxPublisher`, selecting Kafka only when configured and otherwise a log adapter. `CONTACT_RESOLVER` uses the same approach for CRM versus controlled direct references. Internal adapter tokens are not exported unnecessarily. Global modules are limited to cross-cutting infrastructure and still explicitly export public providers. Configuration has explicit behavior: unsafe production/demo settings and missing selected Kafka brokers fail startup; optional workers stay disabled; auth introspection fails closed by default; cache can fail open because the database remains authoritative.

### Code-level follow-up

Write:

```ts
export const CLOCK = Symbol('CLOCK');
export interface Clock { now(): Date; }

@Injectable()
class ExpiryService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}
}

@Module({
  providers: [
    ExpiryService,
    { provide: CLOCK, useValue: { now: () => new Date() } },
  ],
})
class ExpiryModule {}
```

Then show a fixed fake clock in a test.

## 5. Follow-up questions

1. **Why not inject an interface directly?** It has no runtime value for Nest to use as a token.
2. **Symbol vs string token?** Symbols avoid accidental string collisions; export one shared symbol definition.
3. **When does a singleton factory run?** When Nest resolves/instantiates that provider in the application container, normally once for default scope.
4. **Why not make every module global?** It hides dependency edges and weakens isolated composition/testing.
5. **What if a factory throws?** Module/application initialization fails, which is appropriate for invalid required configuration.
6. **Can configuration change after construction?** Raw `process.env` can, but fields/factory results already captured do not; production configuration should be treated as immutable.

## 6. Hands-on exercise

Design `DOCUMENT_CLASSIFIER` with:

- `DocumentClassifier` interface;
- local no-op adapter allowed only in development;
- HTTP production adapter with URL/token/timeouts;
- factory validation that refuses a no-op in production;
- test override;
- optional `close()` cleanup contract;
- documented fail behavior if classification is unavailable.

## 7. Self-assessment

You are ready when you can select the right provider form, explain runtime tokens, prevent duplicate instances and state configuration failure policy rather than merely reading `process.env` everywhere.
