# Lesson 8 code walkthrough: tokens, factories and safe configuration

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This walkthrough follows two symbol-token providers and then separates process configuration, provider construction and startup safety.

## 1. Why an interface needs a runtime token

`OutboxPublisher` is a TypeScript interface. It disappears from emitted JavaScript, so this cannot identify a provider at runtime:

```ts
constructor(private readonly publisher: OutboxPublisher) {}
```

The project creates a stable runtime identity:

```ts
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

constructor(
  @Inject(OUTBOX_PUBLISHER)
  private readonly publisher: OutboxPublisher,
) {}
```

The symbol identifies the provider to Nest; the interface checks compile-time shape for TypeScript.

## 2. Factory binding at the module boundary

`OutboxModule` binds the token:

```ts
@Global()
@Module({
  providers: [
    OutboxService,
    OutboxDispatcher,
    { provide: OUTBOX_PUBLISHER, useFactory: createOutboxPublisher },
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
```

The factory chooses:

```text
OUTBOX_PUBLISHER=kafka
  -> require non-empty KAFKA_BROKERS
  -> KafkaOutboxPublisher
otherwise
  -> LogOutboxPublisher
```

The dispatcher is unaware of Kafka/log configuration. It consumes one `publish(event)` contract and optionally closes the adapter on shutdown.

Notice that `OUTBOX_PUBLISHER` is not exported because only the dispatcher inside this module needs it. Global does not mean every internal token should become public.

## 3. Contact resolver: same pattern, different policy

`EmailModule` binds `CONTACT_RESOLVER` through `createContactResolver`:

```text
CRM_CONTACT_URL set -> HttpContactResolver
not set             -> DirectAddressResolver
```

The direct resolver accepts raw addresses only when `ALLOW_DIRECT_ADDRESS_REFERENCES=true`, except controlled `mailto:` references created from inbound mail. The HTTP resolver applies a five-second timeout and validates returned email/mobile formats.

The worker depends on the interface, not environment variables or a concrete CRM client. This provides:

- one composition point;
- a fake provider for tests;
- no CRM conditional branches in business logic;
- a clear place to validate required adapter configuration.

## 4. Provider forms and exact semantics

| Form | Runtime behavior | Typical use |
|---|---|---|
| `SomeService` | class token uses itself | ordinary injectable service |
| `useClass` | Nest constructs selected class | choose implementation through DI |
| `useValue` | exact object reused | constants/test doubles |
| `useFactory` | call function once for default singleton | configuration-dependent adapter |
| `useExisting` | alias an already-created provider | multiple tokens, same instance |

`useClass` can create a second instance if the implementation is also registered separately. Use `useExisting` when two tokens must refer to the identical instance.

## 5. Inject dependencies into a factory

This repository's factories read process configuration directly, but Nest supports explicit inputs:

```ts
{
  provide: CRM_CLIENT,
  inject: [AppConfig, HttpClient],
  useFactory: (config: AppConfig, http: HttpClient) =>
    new CrmClient(config.crmUrl, http),
}
```

This style makes configuration parsing testable and central. It also avoids every feature reading raw strings independently.

## 6. Three configuration moments

Configuration is read at different times:

| Moment | Example | Consequence |
|---|---|---|
| before Nest creation | `assertProductionSafety()` | process refuses unsafe startup early |
| provider construction | `AuthGuard` issuer/audience/JWKS fields | environment changes afterward do not update that instance |
| operation/tick | worker poll intervals and some feature flags | may observe later process-env changes, though production env should be immutable |

Be explicit about whether a setting is a startup invariant or runtime toggle. Most deployment settings should be parsed once, typed and immutable.

## 7. Fail-fast, fail-closed and optional-disable

Different dependencies need different behavior:

| Condition | Sensible behavior here |
|---|---|
| production uses demo secrets/IdP | fail startup |
| Kafka selected but no brokers | factory throws; fail startup |
| optional worker flag absent | do not start worker |
| token introspection unavailable | fail closed by default; explicit risk option can fail open |
| Redis cache unavailable | fail open to database, because cache is optimization |
| audit DB role can tamper and strict flag true | fail startup |

“Fail fast” is not always the same as “fail closed.” The first is timing; the second is a security outcome. State which property the system protects.

## 8. Startup database-role guard

`DatabaseGuardService.onModuleInit` queries PostgreSQL's own privilege functions. It reports whether the runtime role is owner/superuser or can update/delete/truncate audit events. In strict production mode, unsafe privilege results throw and stop initialization.

This is stronger than trusting a configured username. The database reports effective privileges. A real integration test confirms both safe app and unsafe owner behavior.

## 9. Testing token providers

Override the token, not a concrete implementation hidden behind it:

```ts
const fakePublisher: OutboxPublisher = {
  publish: jest.fn().mockResolvedValue(undefined),
};

const module = await Test.createTestingModule({
  providers: [
    OutboxDispatcher,
    OutboxService,
    { provide: OUTBOX_PUBLISHER, useValue: fakePublisher },
  ],
}).compile();
```

If importing the real module:

```ts
await Test.createTestingModule({ imports: [OutboxModule] })
  .overrideProvider(OUTBOX_PUBLISHER)
  .useValue(fakePublisher)
  .compile();
```

Disable automatic worker startup or call a deterministic one-pass method so tests do not create background timers.

## 10. Configuration review checklist

- Parse strings into bounded numbers/booleans explicitly.
- Treat empty values separately from absence where needed.
- Validate mutually dependent settings together.
- Never log secrets or full connection/token values.
- Choose missing/invalid behavior: disable, fallback or refuse startup.
- Document fail-open security settings and default them closed.
- Keep dev defaults impossible or explicitly rejected in production.
- Put adapter selection at composition boundaries.
- Test production-safety refusal and each factory branch.
