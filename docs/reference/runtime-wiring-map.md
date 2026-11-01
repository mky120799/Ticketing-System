# Runtime wiring map

[Reference index](README.md) · [Module index](../README.md) · [Source coverage](../source-coverage.md)

Nest module metadata is the runtime composition contract. “Imports” below means explicit feature imports; global infrastructure may also be visible after `AppModule` imports it once.

## All 22 Nest modules

| # | Module | Explicit imports | Controllers / active entry points | Providers exported for other modules |
|---:|---|---|---|---|
| 1 | `AppModule` | all feature/infrastructure modules | `HealthController`; global denial interceptor | none; composition root |
| 2 | `AuditModule` (`@Global`) | `AuthModule` | `AuditController`; event/integrity services | `AuditService`, `AuditIntegrityService` |
| 3 | `AuthModule` | none | guard/policy are invoked by other controllers/services | `AuthGuard`, `PolicyService` |
| 4 | `CacheModule` (`@Global`) | none | cache calls from services | `RedisCacheService` |
| 5 | `ComplianceModule` (`@Global`) | `AuthModule` | `ComplianceController`; deadline/privacy/report services | `ComplianceService` |
| 6 | `ConfigurationModule` | `AuthModule` | `ConfigurationController` | `CaseConfigurationService` |
| 7 | `DashboardModule` | Auth, Outbox, Tickets | `DashboardController` | none |
| 8 | `DatabaseModule` (`@Global`) | none | pool plus startup privilege hook | `PgService`, `DatabaseGuardService` |
| 9 | `DirectoryModule` | `AuthModule` | `ProfileController`, `DirectoryController` | `DirectoryService` |
| 10 | `EmailModule` | Intake, Integration | inbound IMAP and outbound delivery lifecycle workers | both worker classes (primarily operational/test access) |
| 11 | `IntakeModule` | Auth, Tickets | `IntakeController`; portal/email services call providers | `IntakeService`, `CustomerReplyService` |
| 12 | `IntegrationModule` | Auth, Outbox | `IntegrationController` | `IntegrationService` |
| 13 | `LiveModule` (`@Global`) | `AuthModule` | `LiveEventsController`; PostgreSQL listener | `LiveEventsService` |
| 14 | `MetricsModule` | none | `MetricsController`; global HTTP metrics interceptor | none |
| 15 | `NotificationsModule` (`@Global`) | `AuthModule` | `NotificationsController` | `NotificationsService` |
| 16 | `OperationsModule` | `AuthModule` | `OutboxAdminController`; scheduled report provider | `ReportExportService` |
| 17 | `OutboxModule` (`@Global`) | none | `OutboxDispatcher` lifecycle worker | `OutboxService` |
| 18 | `PortalModule` | `IntakeModule` | `PortalController`, `PortalAuthGuard` | `PortalService`, `PortalAttachmentsService` |
| 19 | `StorageModule` (`@Global`) | none | adapter initialization and storage methods | `AttachmentStorageService` |
| 20 | `TicketsModule` | Auth, Outbox, Configuration | `TicketsController`, `AttachmentScanWorker` | `SlaService`, `AssignmentService` |
| 21 | `UploadsModule` | `PortalModule` | `UploadsController` capability-token path | none |
| 22 | `WorkflowModule` (`@Global`) | Auth, Tickets, Operations | `WorkflowDefinitionController`, `WorkflowScheduler` | `WorkflowDefinitionService` |

## Why imports do not list every constructor dependency

`TicketsService` injects database, audit, storage, notifications, live events, compliance and workflow dependencies even though `TicketsModule.imports` lists only Auth, Outbox and Configuration. The other providers come from global modules already composed by `AppModule`.

That is legal but changes how you debug:

1. check local providers;
2. check explicitly imported module exports;
3. check global module declarations/exports and whether the root imported them;
4. check the exact runtime token, especially interfaces bound by symbols;
5. reproduce in the same testing-module graph—an isolated feature import may need explicit global infrastructure imports or overrides.

Global visibility should be reserved for stable cross-cutting infrastructure. Security feature dependencies remain explicit where practical so code review can see them.

## Principal provider graph

```text
AppModule
├── edge/root: HealthController + DeniedAuthorizationInterceptor
├── platform globals
│   ├── Database -> PgService + privilege startup check
│   ├── Cache -> RedisCacheService
│   ├── Storage -> AttachmentStorageService
│   ├── Audit -> AuditService + AuditIntegrityService
│   ├── Outbox -> OutboxService + dispatcher + publisher token
│   ├── Live -> LISTEN/NOTIFY fan-out + SSE
│   ├── Notifications -> inbox + audience live hint
│   ├── Compliance -> deadlines/privacy/reporting
│   └── Workflow -> definitions + scheduler + retention/escalation
├── identity: Auth + Directory + PortalAuthGuard
├── aggregate: Tickets + Dashboard
├── channels: Intake + Email + Portal + Uploads
├── integration: Integration + Operations
└── observability/config: Metrics + Configuration
```

## Non-module runtime units

| Unit | Runtime moment | Owner/interaction |
|---|---|---|
| `main.ts` | before listen | Fastify adapter, headers, rate limits, CORS, context, global pipe |
| `production-safety.ts` | before Nest creation | refuses dev IdP/secrets/unsafe audit role settings in production |
| `health.controller.ts` | HTTP probes | liveness process check and dependency readiness |
| `RetentionService` | scheduled provider | declared in `WorkflowModule`; cross-store redaction state |
| `ResolutionNoticeService` | ticket status transaction | declared in `TicketsModule`; governed customer message |
| `CustomerReplyService` | portal/email entry | declared/exported by `IntakeModule`; note + SLA resume |
| publisher/contact tokens | module factory construction | symbols select external adapter implementations |

## Ownership decisions worth explaining

### Directory owns `/me`

`ProfileController` is under `DirectoryModule`, not `AuthModule`, because `/me` records the user's display profile through `DirectoryService`, which itself depends on Auth policy. This avoids a circular module dependency while keeping authentication guard/policy independent of presentation names.

### Retention is not a standalone Nest module

`RetentionService` is scheduled with workflow timing and provided by `WorkflowModule`. It has its own guide because its cross-store destructive behavior is a domain subsystem even without an `@Module` class.

### Uploads and Portal are separate

Signed-in portal document intent/completion lives behind customer identity in `PortalModule`. `UploadsModule` handles a special capability-link path that has no bearer session but validates a narrow expiring token. Similar storage operations do not imply the same trust boundary.

### Workers call services, not controllers

Inbound email delegates normalized work to Intake, scanning calls the protected ticket service using a narrow machine context, and delivery records receipts through Integration. Controllers are HTTP adapters; services own reusable state/policy invariants.

## Adding a new module checklist

1. State exactly what domain/infrastructure boundary it owns.
2. List controllers, workers and public provider tokens.
3. Import only modules whose exported contracts it consumes.
4. Export the smallest provider surface.
5. Decide whether any lifecycle hook starts side effects and how tests disable them.
6. Add it to `AppModule` in an order that does not hide circular ownership.
7. Add source coverage, module guide, frontend/flow links and tests.
8. Verify isolated module compilation and full `AppModule` compilation.
