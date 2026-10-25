# Lesson 1 code walkthrough: resolving the Nest provider graph

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This walkthrough answers a concrete question: when `TicketsService` asks for six constructor dependencies, how does Nest know what to create and where to find it?

## 1. Start at the composition root

Open `apps/api/src/app.module.ts`. `AppModule` does not implement business behavior. Its job is to compose the process:

```ts
@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    StorageModule,
    AuditModule,
    AuthModule,
    TicketsModule,
    // ...the remaining feature modules
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: DeniedAuthorizationInterceptor },
  ],
})
export class AppModule {}
```

At bootstrap, Nest reads this metadata recursively. It creates a module container, registers tokens for each provider/controller, links imported exports, and instantiates eager singleton providers. An `imports` entry is therefore not a TypeScript import convenience; it changes provider visibility in Nest's runtime container.

## 2. Read `TicketsModule` as a dependency contract

Open [tickets.module.ts](../../../apps/api/src/tickets/tickets.module.ts):

```ts
@Module({
  imports: [AuthModule, OutboxModule, ConfigurationModule],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    SlaService,
    AssignmentService,
    ResolutionNoticeService,
    UploadLinkService,
    AttachmentScanWorker,
  ],
  exports: [SlaService, AssignmentService],
})
export class TicketsModule {}
```

Translate it into plain language:

| Metadata | Runtime meaning |
|---|---|
| `imports` | Tokens exported by these modules may be injected here |
| `controllers` | Nest registers their route metadata with the HTTP adapter |
| `providers` | These tokens are owned and instantiated in this module |
| `exports` | Importing modules may inject these selected tokens |

`TicketsService` is intentionally not exported. No other module should bypass the ticket-facing services by injecting the aggregate service arbitrarily. `SlaService` and `AssignmentService` are exported because dashboard/workflow code legitimately reuses them.

## 3. Resolve one constructor by token

For a constructor such as:

```ts
constructor(
  private readonly db: PgService,
  private readonly policy: PolicyService,
  private readonly audit: AuditService,
  private readonly outbox: OutboxService,
  private readonly configuration: CaseConfigurationService,
) {}
```

Nest resolves each runtime token independently:

| Token | Why it is visible to `TicketsModule` |
|---|---|
| `PgService` | `DatabaseModule` is global and exports it |
| `PolicyService` | `TicketsModule` imports `AuthModule`, which exports it |
| `AuditService` | `AuditModule` is global and exports it |
| `OutboxService` | `TicketsModule` imports `OutboxModule`; that module also happens to be global |
| `CaseConfigurationService` | `TicketsModule` imports `ConfigurationModule`, which exports it |

The TypeScript `import` at the top of a service only lets the compiler name a class. It does not register the provider. Runtime visibility comes from module metadata.

## 4. Follow an export across two modules

`DashboardModule` imports `TicketsModule`:

```text
DashboardService
  needs SlaService
    -> DashboardModule imports TicketsModule
      -> TicketsModule owns SlaService
      -> TicketsModule exports SlaService
        -> injection succeeds
```

If `SlaService` were removed from `exports`, Nest would report a dependency-resolution error while compiling `DashboardModule`. Adding another TypeScript import would not fix it.

## 5. Understand global modules precisely

`DatabaseModule` is decorated with `@Global()` and still has both `providers` and `exports`:

```ts
@Global()
@Module({
  providers: [PgService, DatabaseGuardService],
  exports: [PgService, DatabaseGuardService],
})
export class DatabaseModule {}
```

`@Global()` means feature modules need not repeat `DatabaseModule` in `imports` after the global module has been imported by the root graph. It does not make arbitrary classes injectable, and it does not remove the need to export the token.

Global infrastructure is useful for one process-wide database pool, audit writer, storage adapter or cache. Making feature modules global obscures ownership and makes isolated tests harder.

## 6. Provider lifetime in this project

No request or transient scopes are declared here, so providers use Nest's default singleton scope. “Singleton” means one instance per application container, not one instance across every Node process. If three API replicas run, there are three `PgService` objects, each with its own pool.

Consequences:

- mutable fields on a singleton are shared by concurrent requests in one process;
- a singleton cannot safely store the current user or current request;
- process-local locks do not coordinate replicas;
- long-lived clients and timers require shutdown cleanup;
- constructor work runs during graph creation, so constructors should stay cheap and deterministic.

Request state belongs on the request object or in an explicit request-context mechanism, not on `TicketsService` fields.

## 7. How the controller reaches the service

Nest creates `TicketsController`, sees its `TicketsService` constructor parameter, finds the provider in the same module, creates/reuses the service instance and passes it in:

```ts
constructor(private readonly tickets: TicketsService) {}
```

The controller never calls `new TicketsService(...)`. That inversion is what permits tests to replace dependencies and lets module metadata own composition.

## 8. A repeatable dependency-error algorithm

For `Nest can't resolve dependencies of X (?, Y)`:

1. Identify the constructor parameter at the reported index.
2. Determine its runtime token: class, string or symbol.
3. Find the module that declares `X`.
4. If the dependency is local, verify it is in that module's `providers`.
5. If it is external, verify the owning module exports it and the consuming module imports the owner.
6. If the error names `Object`, an interface probably disappeared at runtime; use a symbol token with `@Inject`.
7. Check for an import cycle only after checking ordinary visibility.
8. In a test, verify the testing module provides or overrides the same token.

Do not fix the error by adding the same service to many modules. That can create separate instances and split state or resource ownership.

## 9. Add a provider without breaking ownership

If a `TicketRiskService` is used only inside the ticket feature:

```ts
@Injectable()
export class TicketRiskService {}

@Module({
  providers: [TicketsService, TicketRiskService],
})
export class TicketsModule {}
```

Do not export it until another module has a valid use case. If it needs an external fraud client represented by an interface, bind a symbol token in `TicketsModule` and inject that token. Lesson 8 develops that pattern.

## 10. Code-reading checkpoint

Without looking back, explain:

- why `PolicyService` is visible in `TicketsModule`;
- why `PgService` is visible without a local database import;
- why `TicketsService` is injectable into its controller but not into any arbitrary module;
- why a singleton provider cannot hold `currentUser` in a class field;
- what exact metadata you would inspect for a missing dependency.

If any answer uses only “Nest handles it,” repeat the trace and name the owner module, exported token and consuming import.
