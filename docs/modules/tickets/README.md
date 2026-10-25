# Ticket subsystem guides

[`TicketsModule`](../../../apps/api/src/tickets/tickets.module.ts) is one Nest module but contains several distinct domain subsystems. The overview is [Tickets](../tickets.md); use these pages for code-level interviews and debugging.

1. [Creation, reads and search](create-read-and-search.md)
2. [Mutations, workflow and concurrency](mutations-workflow-and-concurrency.md)
3. [SLA and business time](sla-and-business-time.md)
4. [Assignment and escalation](assignment-and-escalation.md)
5. [Communications, approvals and resolution notices](communications-approvals-and-notices.md)
6. [Attachments, scanning and secure upload links](attachments-scanning-and-upload-links.md)

## Provider graph

```text
TicketsController
  -> TicketsService
      -> PgService + PolicyService
      -> CaseConfigurationService
      -> SlaService
      -> WorkflowDefinitionService
      -> AssignmentService
      -> ComplianceService
      -> AttachmentStorageService
      -> UploadLinkService
      -> ResolutionNoticeService
      -> AuditService + OutboxService
      -> NotificationsService + LiveEventsService

AttachmentScanWorker -> storage stream -> ClamAV -> TicketsService.recordAttachmentScan
WorkflowScheduler -> SlaService + EscalationService
Email DeliveryWorker -> queued ticket communications
```

The controller is transport code. `TicketsService` is the aggregate orchestrator. Specialist services calculate or mutate one bounded concern while receiving the caller's transaction client when atomicity is required.

## Current implementation gaps to remember

- Manual assignment does not validate that `assigneeId` is an active target-queue member.
- Most ticket mutations read the ticket without `FOR UPDATE`, and update SQL does not include `expectedUpdatedAt` in its `WHERE`; the current stale check catches an already-stale browser but not two transactions that read the same version concurrently.
- Most `:ticketId` controller parameters do not use `ParseUUIDPipe`; malformed ids should be normalized to `400` before PostgreSQL.
- Retention deletes object bytes before its locked legal-hold recheck, creating a cross-store race.

These are documented because an interview answer should distinguish what the code currently guarantees from the hardening change you would implement.
