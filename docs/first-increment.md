# First working increment

## In scope

The increment exposes protected ticket creation, scoped metadata search, listing, retrieval, editing, assignment, sensitive-reference reveal, approval, and governed communication endpoints. React provides login, creation, list/search, detail, masked communication history, template-based communication requests, and supervisor approval controls. Every server-side business action is authorized and audited.

## Authorization model

`branch-agent` and `call-center-agent` create tickets within their branch and may read tickets in their allowed queue. `case-agent` can work tickets in an assigned or allowed queue. `supervisor` can assign and approve in managed queues, but never an action they initiated. `auditor` has read/audit visibility and no mutation permissions. `administrator` only administers configuration in the later configuration module and has no implied access to sensitive case content.

The mock IdP must place `roles`, `branch`, `queues`, `department`, `legal_entity`, and `country` claims in human access tokens; missing claims deny human access. Dedicated scanner/reconciler service tokens use only their narrowly scoped service role and do not receive human ticket-context claims.

## Acceptance checks

- Missing, malformed, expired, wrong-issuer, or wrong-audience tokens receive 401.
- Permission or contextual-policy failures receive 403 and create a denied-authorization audit event where a subject is available.
- Cross-queue access and unentitled sensitive-ticket access are denied.
- Customer references remain masked until the controlled reveal endpoint succeeds.
- A ticket creation retry with the same idempotency key returns the prior ticket; a changed request is rejected.
- A self-approval attempt is denied.

## Follow-on case-activity slice

The pilot foundation now also includes PostgreSQL-backed internal/customer notes and governed status transitions. These are intentionally exposed as auditable REST actions until Camunda owns long-running workflow orchestration.

```text
POST /v1/tickets/{ticketId}/notes
POST /v1/tickets/{ticketId}/status
```

Status transitions are allow-listed, record a reason and actor in `ticket_status_history`, and emit an immutable audit event. Cancellation is supervisor-only.

Every newly created ticket also receives an active priority-based SLA policy, first-response deadline, resolution deadline, and running SLA status. Policy rows are held in `sla_policies` so the later configuration service can replace the seeded defaults without changing ticket contracts.

Attachment metadata is also persisted without file bytes: the API creates an opaque object key and S3-compatible presigned upload intent when storage is configured, records checksum and size on completion, and leaves `malware_status=pending_scan` until the distinct `attachment-scanner` service identity calls the scan callback with `clean`, `malicious`, or `error`. `GET /v1/tickets/{ticketId}/attachments/{attachmentId}/download` only issues a bounded presigned GET URL after a clean scan; unscanned content is rejected and local disk is never used.

Tickets can be linked through `duplicate_of`, `related_to`, or `parent_of` relationships. Cross-entity links and self-links are rejected, and relationship reads expose only opaque ticket IDs and relationship direction.

Supervisors and auditors can read `GET /v1/dashboard/summary`, which returns scoped aggregate totals, queue workload, aging buckets, and overdue SLA counts. It never returns ticket descriptions, customer references, or attachment content, and each report access is audited.

Supervisors can set a ticket retention date or legal hold with `PUT /v1/tickets/{ticketId}/retention`. Enabling a hold requires a reason, persists the control separately from ticket content, audits the change, and emits only the hold flag/date through the outbox. Hold reasons are never included in integration events.

Business mutations also write minimized integration events to `integration_outbox` in the same transaction as the ticket change. The outbox contains only opaque IDs and operational metadata; its dispatcher claims rows with row-level locking, acknowledges successful publishes, retries with bounded exponential backoff, and moves five-time failures to `dead_letter`. Audit rows are database-enforced append-only through a PostgreSQL mutation trigger. The `OutboxDispatcher` loop (enabled with `OUTBOX_DISPATCHER_ENABLED=true`) drains the outbox through a pluggable publisher (`OUTBOX_PUBLISHER=log|kafka`) and releases rows abandoned by a crashed process; details are in [`implementation-log.md`](implementation-log.md). A bank-approved bus replaces the Kafka publisher class when chosen.

Published outbox events can receive an idempotent receipt from the distinct `integration-reconciler` service identity at `POST /v1/integrations/outbox/{eventId}/receipts`. The receipt ledger stores only external system/reference, outcome, optional payload hash, and timestamp; conflicting duplicate receipts are rejected and customer payloads are never accepted.

Controlled customer communications are now represented as governed ticket actions. `POST /v1/tickets/{ticketId}/communications` accepts only seeded active templates and matching `email`, `sms`, or `portal` channels. Recipient references are masked in responses and ticket detail; the raw value is retained only in the protected database boundary. Templates that require maker-checker review create a linked approval request, enter `pending_approval`, and emit a distinct non-delivery event. An independent approver transitions them to `queued`, which emits the delivery-intent event. A distinct `notification-provider` service identity can post idempotent `sent`, `delivered`, or `failed` receipts at `POST /v1/integrations/communications/{communicationId}/receipts`; state transitions are monotonic and delivery outbox events contain no recipient or provider payload.

Auditors can retrieve a scoped immutable event report with `GET /v1/audit/tickets/{ticketId}` or export it with `GET /v1/audit/tickets/{ticketId}/export`. Both responses include event hashes and operational metadata only; viewing and exporting are distinct actions appended to the audit chain.

Active queues, categories, SLA policies, and communication templates are governed by `case_queues`, `ticket_categories`, `sla_policies`, and `communication_templates`; scoped reads expose only safe active configuration. Administrator-only queue/category/SLA/template mutations are validated, audited, and emitted through the outbox. `POST /v1/dashboard/sla/reconcile` is an idempotent supervisor/administrator hook for the future Camunda timer worker; it updates only scoped overdue tickets and emits one minimized state-change event per transition. Ticket creation rejects incompatible category/queue/department/entity combinations.

Redis is available as an optional cache for the safe active communication-template list. Cache connection or serialization failures fail open to PostgreSQL, writes invalidate the key, and no ticket, authorization, SLA, or audit decision depends on Redis.

## Routing, SLA timer and escalation

Administrators configure queue members, assignment rules (`least_loaded` or `round_robin`, matched by queue/category/priority) and escalation rules under `/v1/configuration`. New tickets are auto-assigned in the creating transaction. A scheduler (`WORKFLOW_SCHEDULER_ENABLED=true`) recomputes SLA status and escalates overdue tickets as the `system:*` actors, idempotently per ticket and rule; every action is audited, emitted to the outbox and pushed live. See [`implementation-log.md`](implementation-log.md) entry 3.

## Live updates

`GET /v1/events/stream` is a Server-Sent Events stream of minimized ticket-change notifications (`ticket.created`, `ticket.updated`, `ticket.assigned`, `ticket.status_changed`, `ticket.note_added`). Events are raised with `pg_notify` inside the business transaction, so they are delivered only after commit, and each connected user receives only events for tickets that pass the same policy check as `GET /v1/tickets/{id}`. Payloads contain an opaque ticket ID and status only; clients refetch through the audited REST API. Streams are capped at five per user, send heartbeats, and close when the access token expires. A `resync` event tells clients to refetch after a listener reconnect. Design and trade-offs are in [`implementation-log.md`](implementation-log.md).

## Before production

Replace local Keycloak with the bank IdP, inject secrets through Vault, configure gateway/WAF, mTLS, KMS-backed storage, SIEM, retention/legal holds, malware scanning, OpenTelemetry export, SAST/DAST, and disaster-recovery controls. Complete privacy, threat-model, and security-review sign-off.
