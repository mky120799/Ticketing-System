# Source-to-documentation coverage

This page is the completeness check. It is generated conceptually from every `apps/api/src/**/*.module.ts` file and then extended with controllers/providers that are not standalone Nest modules. A feature is not considered covered merely because its name appears in another page: the final column points to the detailed guide.

Coverage answers “is every source area documented?” For comparison across modules, continue with the [runtime wiring](reference/runtime-wiring-map.md), [data/consistency](reference/data-and-consistency-map.md), [frontend/backend](reference/frontend-to-backend-map.md), and [failure/test](reference/failure-and-test-map.md) maps.

## Nest modules: 22 of 22

| # | Source module | Controllers and principal providers | Detailed documentation |
|---:|---|---|---|
| 1 | [`AppModule`](../../apps/api/src/app.module.ts) | `HealthController`, global denial interceptor, full import graph | [Application composition and bootstrap](application-bootstrap.md) |
| 2 | [`AuditModule`](../../apps/api/src/audit/audit.module.ts) | `AuditController`, `AuditService`, `AuditIntegrityService` | [Audit index](audit/README.md) |
| 3 | [`AuthModule`](../../apps/api/src/auth/auth.module.ts) | `AuthGuard`, `PolicyService` | [Authentication](authentication/README.md), [Authorization](authorization.md) |
| 4 | [`CacheModule`](../../apps/api/src/cache/cache.module.ts) | `RedisCacheService` | [Cache](cache.md) |
| 5 | [`ComplianceModule`](../../apps/api/src/compliance/compliance.module.ts) | `ComplianceController`, `ComplianceService` | [Compliance](compliance.md) |
| 6 | [`ConfigurationModule`](../../apps/api/src/configuration/configuration.module.ts) | configuration controller and case/routing services | [Configuration](configuration.md) |
| 7 | [`DashboardModule`](../../apps/api/src/dashboard/dashboard.module.ts) | `DashboardController`, `DashboardService` | [Dashboard](dashboard.md) |
| 8 | [`DatabaseModule`](../../apps/api/src/database/database.module.ts) | `PgService`, `DatabaseGuardService` | [Database](database.md) |
| 9 | [`DirectoryModule`](../../apps/api/src/directory/directory.module.ts) | `ProfileController`, `DirectoryController`, `DirectoryService` | [Directory](directory.md), [`/me` profile](authentication/profile-and-me.md) |
| 10 | [`EmailModule`](../../apps/api/src/email/email.module.ts) | inbound/delivery workers, contact resolver | [Email](email.md) |
| 11 | [`IntakeModule`](../../apps/api/src/intake/intake.module.ts) | `IntakeController`, `IntakeService`, `CustomerReplyService` | [Intake](intake.md) |
| 12 | [`IntegrationModule`](../../apps/api/src/integrations/integration.module.ts) | `IntegrationController`, `IntegrationService` | [Integrations](integrations.md) |
| 13 | [`LiveModule`](../../apps/api/src/live/live.module.ts) | SSE controller and listener/fan-out service | [Live events](live-events.md) |
| 14 | [`MetricsModule`](../../apps/api/src/metrics/metrics.module.ts) | metrics controller/service, global HTTP interceptor | [Metrics](metrics.md) |
| 15 | [`NotificationsModule`](../../apps/api/src/notifications/notifications.module.ts) | notification controller/service | [Notifications](notifications.md) |
| 16 | [`OperationsModule`](../../apps/api/src/operations/operations.module.ts) | outbox admin and report export | [Operations](operations.md) |
| 17 | [`OutboxModule`](../../apps/api/src/outbox/outbox.module.ts) | outbox service, dispatcher and publisher | [Outbox](outbox.md) |
| 18 | [`PortalModule`](../../apps/api/src/portal/portal.module.ts) | portal controller/guard/services | [Customer portal](portal.md) |
| 19 | [`StorageModule`](../../apps/api/src/storage/storage.module.ts) | object storage and ClamAV adapter | [Storage and uploads](storage-and-uploads.md) |
| 20 | [`TicketsModule`](../../apps/api/src/tickets/tickets.module.ts) | controller, aggregate service, SLA, assignment, scanning, notices, upload links | [Tickets index](tickets.md) and [ticket subsystem guides](tickets/README.md) |
| 21 | [`UploadsModule`](../../apps/api/src/uploads/uploads.module.ts) | capability-link upload controller/service | [Storage and uploads](storage-and-uploads.md), [attachments and links](tickets/attachments-scanning-and-upload-links.md) |
| 22 | [`WorkflowModule`](../../apps/api/src/workflow/workflow.module.ts) | definitions, escalation and scheduler | [Workflow](workflow.md), [assignment and escalation](tickets/assignment-and-escalation.md) |

## Runtime features that are not separate Nest modules

| Source unit | Why it still needs documentation | Guide |
|---|---|---|
| [`main.ts`](../../apps/api/src/main.ts) | Creates Fastify/Nest, headers, rate limits, CORS, validation and prefix | [Application composition and bootstrap](application-bootstrap.md) |
| [`health.controller.ts`](../../apps/api/src/health.controller.ts) | Liveness/readiness probes | [Health and production safety](health-and-production-safety.md) |
| [`production-safety.ts`](../../apps/api/src/production-safety.ts) | Refuses unsafe production configuration before listen | [Health and production safety](health-and-production-safety.md) |
| [`profile.controller.ts`](../../apps/api/src/auth/profile.controller.ts) | `/me` and Directory refresh | [`/me` profile](authentication/profile-and-me.md) |
| `SlaService` and business calendar | Deadline calculation, pause/resume and reconciliation | [SLA and business time](tickets/sla-and-business-time.md) |
| `AssignmentService` and `EscalationService` | Automatic routing and overdue movement | [Assignment and escalation](tickets/assignment-and-escalation.md) |
| `ResolutionNoticeService` | Governed automatic customer notification on resolution | [Communications, approvals and notices](tickets/communications-approvals-and-notices.md) |
| `AttachmentScanWorker` and upload-link token/service | File state machine and capability security | [Attachments, scanning and upload links](tickets/attachments-scanning-and-upload-links.md) |
| `CustomerReplyService` | Shared portal/email reply behavior and SLA resume | [Intake](intake.md) and [portal request flow](../flows/portal-request-and-reply.md) |
| Audit archive/hash/signer/request context | Evidence lifecycle beyond the module providers | [Audit index](audit/README.md) |

## Frontend feature coverage

| Source area | Guide |
|---|---|
| Staff app providers, routes and layout | [Staff console bootstrap and routing](../frontend/staff-console-bootstrap-and-routing.md) |
| Typed HTTP client, errors and correlation | [API client and data flow](../frontend/api-data-flow.md) |
| Ticket list, search, pagination and cache patching | [Ticket list and React Query](../frontend/ticket-list-and-react-query.md) |
| Ticket workspace, tabs and mutations | [Ticket workspace](../frontend/ticket-workspace.md) |
| Administration sections | [Administration frontend](../frontend/administration.md) |
| Customer portal and link upload page | [Customer portal frontend](../frontend/customer-portal.md) |
| OIDC/session/capabilities | [Authentication and session](../frontend/authentication-and-session.md) |
| SSE synchronization | [Live events](live-events.md) |

When a new module, controller or provider is added, update this table in the same change as its implementation documentation.
