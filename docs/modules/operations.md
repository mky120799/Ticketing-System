# Operations module

Operations provides controlled recovery for outbox failures and scheduled report exports. These are privileged operational capabilities, not generic administrator shortcuts.

## Wiring and outbox administration

[`OperationsModule`](../../apps/api/src/operations/operations.module.ts) imports Auth, registers [`OutboxAdminController`](../../apps/api/src/operations/outbox-admin.controller.ts), `OutboxAdminService` and `ReportExportService`, and exports the report service for Workflow scheduling.

All `/operations/outbox` routes use `AuthGuard` and require `configuration:write`:

| Route | Behavior |
|---|---|
| `GET /summary` | Count rows by outbox status |
| `GET /events?status=&limit=` | Return minimized metadata, limited to 200 |
| `POST /events/:id/replay` | Replay one dead-letter UUID |
| `POST /replay` | Replay up to 500, optionally by event type |

[`OutboxAdminService`](../../apps/api/src/operations/outbox-admin.service.ts) never returns event payloads in the list. Replay updates only `dead_letter` rows, resets retry state and writes `outbox.replayed` audit evidence in the same transaction. Batch replay selects with `FOR UPDATE SKIP LOCKED`, so concurrent operators/instances do not claim the same batch. A single id not currently dead-lettered returns not found rather than mutating an in-flight/published event.

## Scheduled report export

[`ReportExportService`](../../apps/api/src/operations/report-export.service.ts) is invoked by the workflow scheduler when enabled. It enumerates active legal-entity/country scopes, generates a 30-day complaint register and 12-week volume report for each, converts them to safe CSV and stores them under a date/scope object prefix.

Rows are bounded (complaints cap at 50,000), fields are classifications/dates/outcomes/opaque ids, and queries never mix scopes. Storage errors are logged per file so one failed upload does not corrupt another scope. Successful work writes system-actor audit evidence without embedding report contents.

## Frontend and runbook behavior

[`integration-section.tsx`](../../apps/web/src/features/admin/sections/integration-section.tsx) shows outbox health, dead-letter metadata and replay controls. The UI should require deliberate confirmation, refetch after replay and explain that replay means “make eligible for dispatch,” not “provider has processed it.”

Operators should first resolve the provider/configuration fault, inspect event type and attempts, replay a small sample, verify publication/receipt, then replay a bounded batch. Audit provides who initiated recovery and how many records moved.

## Tests and interview answer

Test permission denial, status/limit validation, replay of only dead letters, one-versus-batch bounds, concurrent batch selection, audit rollback and report scope/file failure. Never include sensitive outbox payloads in operational list or logs.

> I built operations as explicit, audited recovery commands. Outbox inspection returns only metadata, and replay can move only dead-letter rows back to retry. Batch replay is bounded and uses skip-locked selection. Scheduled reports are generated independently per legal entity/country, stored in object storage and audited by a system actor. The React admin screen displays state but the server enforces every limit and permission.
