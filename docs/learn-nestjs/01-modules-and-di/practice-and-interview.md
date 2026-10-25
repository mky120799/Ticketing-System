# Lesson 1 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Build the graph by hand

Draw this subset without copying the source:

```text
AppModule
├── DatabaseModule -> PgService
├── AuditModule -> AuditService
├── AuthModule -> AuthGuard, PolicyService
├── ConfigurationModule -> CaseConfigurationService
├── OutboxModule -> OutboxService, OutboxDispatcher
└── TicketsModule -> TicketsController, TicketsService, SlaService, ...
```

Mark every imported module, locally owned provider and exported provider. Then answer: which dependencies are explicit feature imports, and which are available because of global infrastructure?

## 2. Debugging drill: missing export

Suppose `DashboardService` injects `AssignmentService`, `DashboardModule` imports `TicketsModule`, and startup fails.

Broken module:

```ts
@Module({
  providers: [TicketsService, AssignmentService],
  exports: [SlaService],
})
export class TicketsModule {}
```

Diagnosis: `AssignmentService` is owned but not exported. Add it to `exports`. Do not add `AssignmentService` to `DashboardModule.providers`, because that changes ownership and can create a second instance with a different dependency context.

## 3. Debugging drill: interface injection

Broken code:

```ts
interface Publisher { publish(value: unknown): Promise<void>; }

@Injectable()
class Dispatcher {
  constructor(private readonly publisher: Publisher) {}
}
```

At runtime the interface has been erased, so Nest often reports `Object` at the unresolved position.

Correct shape:

```ts
export const PUBLISHER = Symbol('PUBLISHER');

@Injectable()
class Dispatcher {
  constructor(@Inject(PUBLISHER) private readonly publisher: Publisher) {}
}

@Module({
  providers: [
    Dispatcher,
    { provide: PUBLISHER, useFactory: createPublisher },
  ],
})
class MessagingModule {}
```

## 4. Design drill

Place each item in the most appropriate module and justify the export decision:

| Item | Likely owner | Export? |
|---|---|---|
| ticket transition rules | Tickets/Workflow | only if another bounded feature consumes the contract |
| database pool | Database | yes, global infrastructure |
| ticket controller | Tickets | no; controllers expose routes, not DI contracts |
| contact resolver adapter | Email | usually no; consumed by email workers only |
| assignment algorithm | Tickets | yes here because workflow/dashboard reuse it |

There is no universal “one module per class” rule. The decision is about cohesive ownership and a deliberately small public provider surface.

## 5. Interview answer at three depths

### 30 seconds

> I organize the API by feature modules. Each module declares its controllers and providers, imports provider contracts it needs, and exports only reusable services. Nest builds that graph at startup and performs constructor injection by runtime token. Shared infrastructure such as the database and audit service is global, while security and feature dependencies stay explicit.

### Two minutes

> `AppModule` is the composition root. For example, `TicketsModule` owns `TicketsController`, `TicketsService`, the SLA and assignment services, and its scan worker. It imports `AuthModule`, `OutboxModule` and `ConfigurationModule`; those imports make their exported providers visible. `PgService` and `AuditService` come from global modules that are imported once by the root. The module exports only `SlaService` and `AssignmentService`, because dashboard and workflow need them. Providers use the default singleton scope per Node process, so I never store request/user state in provider fields. When Nest reports an unresolved dependency, I identify the constructor index, runtime token, provider owner, export and consuming import in that order.

### Code-level follow-up

Be ready to write:

```ts
@Module({
  imports: [AuthModule],
  controllers: [ExampleController],
  providers: [ExampleService],
  exports: [ExampleService],
})
export class ExampleModule {}
```

Then explain that the TypeScript import names a class but Nest module metadata controls runtime visibility.

## 6. Questions interviewers use to expose gaps

1. **Why not instantiate services with `new`?** You would own dependency construction, lifecycle and replacement; Nest's container could not compose or override them consistently.
2. **Is a default provider a system-wide singleton?** No. It is one instance per Nest application container/process.
3. **What does `exports` expose?** Provider tokens to modules that import this module; it does not expose routes.
4. **What does `@Global()` remove?** Repeated module imports in feature modules, not the need to declare and export providers.
5. **Why are too many global modules dangerous?** Dependencies become implicit, module isolation weakens and tests can accidentally rely on root composition.
6. **Can Nest inject a TypeScript interface?** Not directly; interfaces have no runtime value, so bind a runtime token.
7. **What causes circular dependencies?** Usually two features own behavior from each other. First revisit ownership; `forwardRef` is a last-resort wiring mechanism, not a design goal.

## 7. Hands-on exercise

Create a paper design for `RiskModule` with:

- `RiskController`;
- `RiskService`;
- a `RISK_PROVIDER` symbol;
- a factory-bound external adapter;
- `AuthModule` imported for policy;
- `RiskService` exported only if another feature genuinely calls it.

Write the constructor of each class and trace every parameter to its owner. Your answer is complete only when every token has exactly one obvious registration.

## 8. Self-assessment rubric

| Level | Evidence |
|---|---|
| Memorized | can define module/provider/DI |
| Working | can wire a feature and fix a missing import/export |
| Code-level | can resolve every `TicketsService` dependency from the graph |
| Interview-ready | can discuss scopes, token erasure, global trade-offs and ownership without guessing |
