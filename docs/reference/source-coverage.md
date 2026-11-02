# Source-to-documentation coverage

The completeness check: every source area mapped to the topic folder that explains it. When a module, controller, worker or screen is added, update this table in the same change.

[Reference index](README.md) · [Documentation home](../README.md)

---

## Nest modules: 22 of 22

| # | Source module | Controllers and principal providers | Topic folder |
|---:|---|---|---|
| 1 | [`AppModule`](../../apps/api/src/app.module.ts) | `HealthController`, global denied-audit interceptor | [API bootstrap](../api-bootstrap/README.md), [Observability](../observability/health-and-logs.md) |
| 2 | [`AuditModule`](../../apps/api/src/audit/audit.module.ts) | `AuditController`, `AuditService`, `AuditIntegrityService` | [Audit](../audit/README.md) |
| 3 | [`AuthModule`](../../apps/api/src/auth/auth.module.ts) | `AuthGuard`, `PolicyService` | [Auth](../auth/README.md) |
| 4 | [`CacheModule`](../../apps/api/src/cache/cache.module.ts) | `RedisCacheService` | [Cache](../cache/README.md) |
| 5 | [`ComplianceModule`](../../apps/api/src/compliance/compliance.module.ts) | `ComplianceController`, `ComplianceService` | [Compliance](../compliance/README.md) |
| 6 | [`ConfigurationModule`](../../apps/api/src/configuration/configuration.module.ts) | `ConfigurationController`, `CaseConfigurationService`, `RoutingConfigurationService` | [Configuration](../configuration/README.md), [Routing admin](../assignment-and-routing/routing-admin.md) |
| 7 | [`DashboardModule`](../../apps/api/src/dashboard/dashboard.module.ts) | `DashboardController`, `DashboardService` | [Dashboard](../dashboard/README.md) |
| 8 | [`DatabaseModule`](../../apps/api/src/database/database.module.ts) | `PgService`, `DatabaseGuardService` | [Database](../database/README.md) |
| 9 | [`DirectoryModule`](../../apps/api/src/directory/directory.module.ts) | `ProfileController` (`/me`), `DirectoryController`, `DirectoryService` | [Directory](../directory/README.md), [Auth → /me](../auth/profile-and-me.md) |
| 10 | [`EmailModule`](../../apps/api/src/email/email.module.ts) | `DeliveryWorker`, `InboundEmailWorker`, `CONTACT_RESOLVER` | [Communications → delivery](../communications/delivery-and-receipts.md), [Intake → inbound email](../intake/inbound-email.md) |
| 11 | [`IntakeModule`](../../apps/api/src/intake/intake.module.ts) | `IntakeController`, `IntakeService`, `CustomerReplyService` | [Intake](../intake/README.md) |
| 12 | [`IntegrationModule`](../../apps/api/src/integrations/integration.module.ts) | `IntegrationController`, `IntegrationService` | [Outbox → receipts](../outbox/receipts-and-operations.md), [Communications → receipts](../communications/delivery-and-receipts.md#3-delivery-receipts-idempotent-monotonic) |
| 13 | [`LiveModule`](../../apps/api/src/live/live.module.ts) | `LiveEventsController`, `LiveEventsService` | [Live updates](../live-updates/README.md) |
| 14 | [`MetricsModule`](../../apps/api/src/metrics/metrics.module.ts) | `MetricsController`, `MetricsService`, HTTP interceptor | [Observability → metrics](../observability/metrics.md) |
| 15 | [`NotificationsModule`](../../apps/api/src/notifications/notifications.module.ts) | `NotificationsController`, `NotificationsService` | [Notifications](../notifications/README.md) |
| 16 | [`OperationsModule`](../../apps/api/src/operations/operations.module.ts) | `OutboxAdminController`, `OutboxAdminService`, `ReportExportService` | [Outbox → operations](../outbox/receipts-and-operations.md), [Compliance → scheduled reports](../compliance/reports-and-privacy.md#4-scheduled-report-export) |
| 17 | [`OutboxModule`](../../apps/api/src/outbox/outbox.module.ts) | `OutboxService`, `OutboxDispatcher`, `OUTBOX_PUBLISHER` | [Outbox](../outbox/README.md) |
| 18 | [`PortalModule`](../../apps/api/src/portal/portal.module.ts) | `PortalController`, `PortalAuthGuard`, `PortalService`, `PortalAttachmentsService` | [Portal](../portal/README.md), [Customer documents](../attachments/customer-documents.md) |
| 19 | [`StorageModule`](../../apps/api/src/storage/storage.module.ts) | `AttachmentStorageService` (+ `clamav.client.ts`) | [Attachments](../attachments/staff-upload-flow.md#2-the-storage-adapter), [Scanning](../attachments/malware-scanning.md) |
| 20 | [`TicketsModule`](../../apps/api/src/tickets/tickets.module.ts) | `TicketsController`, `TicketsService`, `SlaService`, `AssignmentService`, `ResolutionNoticeService`, `UploadLinkService`, `AttachmentScanWorker` | [Tickets](../tickets/README.md), [SLA](../sla/README.md), [Auto-assignment](../assignment-and-routing/auto-assignment.md), [Resolution notice](../communications/resolution-notice.md), [Upload links](../attachments/secure-upload-links.md), [Scanning](../attachments/malware-scanning.md) |
| 21 | [`UploadsModule`](../../apps/api/src/uploads/uploads.module.ts) | `UploadsController`, `UploadsService` | [Secure upload links](../attachments/secure-upload-links.md) |
| 22 | [`WorkflowModule`](../../apps/api/src/workflow/workflow.module.ts) | `WorkflowDefinitionController/Service`, `EscalationService`, `WorkflowScheduler`, `RetentionService` | [Workflow](../workflow/README.md), [Escalation](../assignment-and-routing/escalation.md), [Retention](../retention/README.md) |

## Runtime units that aren't separate modules

| Source | Topic |
|---|---|
| [`main.ts`](../../apps/api/src/main.ts) | [API bootstrap](../api-bootstrap/bootstrap-and-modules.md) |
| [`production-safety.ts`](../../apps/api/src/production-safety.ts) | [Auth → token hardening](../auth/token-hardening.md#5-production-safety-gate) |
| [`health.controller.ts`](../../apps/api/src/health.controller.ts) | [Observability → health](../observability/health-and-logs.md) |
| [`audit/request-context.ts`](../../apps/api/src/audit/request-context.ts) | [Audit concepts](../audit/concepts.md#7-request-context), [API bootstrap](../api-bootstrap/bootstrap-and-modules.md) |
| [`audit/audit-archive.ts`](../../apps/api/src/audit/audit-archive.ts), [`anchor-signer.ts`](../../apps/api/src/audit/anchor-signer.ts) | [Audit integrity](../audit/integrity-and-anchors.md) |
| [`compliance/business-calendar.ts`](../../apps/api/src/compliance/business-calendar.ts) | [SLA → business calendar](../sla/business-calendar.md) |
| [`compliance/csv.ts`](../../apps/api/src/compliance/csv.ts) | [Compliance → CSV safety](../compliance/reports-and-privacy.md#3-csv-safety) |
| [`email/message-template.ts`](../../apps/api/src/email/message-template.ts) | [Communications → templates](../communications/creating-and-approving.md#2-templates-and-placeholders) |
| [`email/contact-resolver.ts`](../../apps/api/src/email/contact-resolver.ts) | [Communications → contact resolution](../communications/delivery-and-receipts.md#2-contact-resolution-no-contact-data-stored) |
| [`migrations/`](../../apps/api/migrations/) | [Database → migrations](../database/migrations-and-roles.md), [Tickets → data model](../tickets/data-model.md) |
| [`scripts/`](../../apps/api/scripts/) | archive/keys: [Audit](../audit/integrity-and-anchors.md); migrate: [Database](../database/migrations-and-roles.md); event catalogue: [Outbox](../outbox/event-catalogue.md); simulate intake: [Intake](../intake/channel-intake.md) |
| [`infra/postgres/roles.sql`](../../infra/postgres/roles.sql) | [Database → roles](../database/migrations-and-roles.md#5-roles-owner-app-reporting), [Audit → database protection](../audit/database-protection.md) |

## Staff console (`apps/web`)

| Source area | Topic |
|---|---|
| `main.tsx`, `app.tsx`, `layout/`, `pages/` | [Frontend → app shell](../frontend-architecture/app-shell-and-routing.md) |
| `auth.ts`, `session/`, `layout/login-page.tsx`, `layout/step-up-banner.tsx` | [Auth → frontend session](../auth/frontend-session.md) |
| `api.ts`, `config.ts` | [Frontend → API client](../frontend-architecture/api-client.md) |
| `lib/query-client.ts`, `lib/query-keys.ts` | [Frontend → data fetching](../frontend-architecture/data-fetching.md) |
| `lib/labels.ts`, `lib/format.ts`, `lib/notify.ts`, `components/`, `theme.ts` | [Frontend → UI conventions](../frontend-architecture/ui-conventions.md) |
| `features/tickets/` | [Tickets → queue](../tickets/frontend-queue.md) |
| `features/ticket/` (+ tabs) | [Tickets → workspace](../tickets/frontend-workspace.md) and each tab's topic |
| `features/audit/` | [Audit → frontend](../audit/frontend.md) |
| `features/dashboard/` | [Dashboard](../dashboard/how-it-works.md#5-frontend) |
| `features/admin/` | [Configuration → frontend](../configuration/frontend.md) |
| `layout/notification-menu.tsx` | [Notifications → the bell](../notifications/frontend.md) |
| `live/use-live-updates.ts` | [Live updates → frontend](../live-updates/frontend.md) |
| `components/person-name.tsx` | [Directory](../directory/how-it-works.md#6-personname-batching-in-the-browser) |

## Customer portal (`apps/portal`)

| Source area | Topic |
|---|---|
| everything | [Portal → frontend](../portal/frontend.md) |
| `upload-page.tsx`, `components/documents.tsx` | [Attachments → frontend](../attachments/frontend.md), [Secure upload links](../attachments/secure-upload-links.md) |

## Tests

| Test | Topic testing page |
|---|---|
| `auth.guard.spec`, `auth-hardening.spec`, `security.policy.spec`, `unauthenticated.e2e-spec`, `production-safety.spec` | [Auth → testing](../auth/testing.md) |
| `roles.integration-spec`, audit parts of `workflow.integration-spec` | [Audit → testing](../audit/testing.md) |
| `ticket.integration-spec` | [Tickets → testing](../tickets/testing.md) |
| `business-calendar.spec` | [SLA → business calendar](../sla/business-calendar.md#6-tests) |
| `storage.integration-spec`, `attachment-storage.service.spec`, `upload-link-token.spec` | [Attachments](../attachments/staff-upload-flow.md#3-tests) |
| `email.integration-spec` | [Intake → inbound email](../intake/inbound-email.md#5-test) |
| `portal.integration-spec` | [Portal → backend](../portal/backend.md#8-tests) |
| `kafka.integration-spec` | [Outbox → Kafka](../outbox/publishers-and-kafka.md#5-kafka-test) |
| `redis-cache.service.spec` | [Cache](../cache/README.md) |
| `e2e/tests/*` (Playwright + axe) | [Auth testing](../auth/testing.md), [Portal](../portal/backend.md#8-tests), [Upload links](../attachments/secure-upload-links.md#7-tests) |
