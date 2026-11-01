# Migrations and roles

[Back to Database index](README.md)

---

## 1. Migrations

- Tool: **node-pg-migrate**. Plain JS files numbered by timestamp in [apps/api/migrations/](../../apps/api/migrations/), each with `up` and `down`.
- Run: `npm run migration:run --workspace=@bank-case/api` (`node-pg-migrate up -m migrations -d DATABASE_URL`), or in containers [scripts/migrate.mjs](../../apps/api/scripts/migrate.mjs), which locates the tool wherever npm installed it.
- **Run as the schema owner** (`case_owner`), never as the app account.
- The tool records applied migrations in a `pgmigrations` table, so a migration runs exactly once per database.

### The migrations, in story order

| # | Migration | Adds |
|---|---|---|
| 0000 | initial | tickets, references, idempotency, approvals, audit_events |
| 1000 | case_activity | notes, status history |
| 2000 | sla_policies | SLA policies + ticket SLA columns |
| 3000 | attachments | attachments |
| 4000 | ticket_relationships | links |
| 5000 | integration_outbox | outbox |
| 6000 | case_configuration | queues, categories (+ seeds) |
| 7000-8000 | communications, approvals | templates, communications, approval link |
| 9000 | retention_controls | legal hold table |
| 10000 | audit_immutability | append-only trigger |
| 11000 | sla_status_width | column widening |
| 12000-13000 | receipts | integration + delivery receipts |
| 14000 | outbox_claim_tracking | `claimed_at` |
| 15000 | routing_and_escalation | members, assignment & escalation rules, escalations |
| 16000 | intake_channels | channels, intake ledger, `source_channel` |
| 17000 | sla_accuracy_root_cause | first response, resolved, root cause |
| 18000 | regulatory_complaints | profiles, holidays, complaint columns, AU seeds |
| 19000 | workflow_definitions | workflows + `standard` |
| 20000 | retention_enforcement | `closed_at`, `redacted_at`, `retention_years` |
| 21000 | audit_integrity | `hash_version`, verifications, anchors |
| 22000 | notifications_and_email | template wording, delivery columns, notifications |
| 23000 | audit_truncate_guard | TRUNCATE trigger |
| 24000 | audit_archive_and_signing | anchor signatures, chain bases |
| 25000 | paging_and_reporting | paging index, `reporting.*` views |
| 26000 | sla_calendars_and_pause | calendar, pause, business hours |
| 27000 | privacy_correction | case kind, APP 13 profile |
| 28000 | resolution_notice | category flag |
| 29000 | upload_links | links + document-request templates |
| 30000 | staff_directory | directory |

**Plain:** the folder reads like the product's history, one capability per migration.

## 2. Roles

See [audit → database protection](../audit/database-protection.md#2-owner-vs-runtime-vs-reporting-roles) for `case_owner` / `case_app` / `case_reporting`, the revoked audit privileges and the startup self-check ([database-guard.service.ts](../../apps/api/src/database/database-guard.service.ts)).

## 3. Reporting views

`reporting.tickets`, `.status_history`, `.escalations`, `.communications` ([migration 25000](../../apps/api/migrations/1710000025000_paging_and_reporting.cjs#L8-L15)): BI tools read classifications, dates and opaque IDs without touching case content.

## 4. Backups and recovery

See [operations/disaster-recovery.md](../operations/disaster-recovery.md). The audit chain base and anchors mean a restored database can still be **verified** against externally stored anchors.
