# Compliance module

Compliance owns complaint classification, regulatory deadlines, external-dispute references, communication blocks, privacy subject-access output, complaint-register reports and the business calendar used for deadlines. It adds rules to a ticket; it does not bypass ticket authorization.

## Wiring and routes

[`ComplianceModule`](../../apps/api/src/compliance/compliance.module.ts) is global, imports Auth, registers [`ComplianceController`](../../apps/api/src/compliance/compliance.controller.ts) and `ComplianceService`, and exports the service for Tickets and Workflow.

| Route | Purpose |
|---|---|
| `PUT /tickets/:id/complaint` | Classify/update complaint indicators |
| `POST /tickets/:id/afca` | Record external dispute details |
| `PUT /tickets/:id/communication-block` | Block/unblock permitted communications |
| `POST /privacy/subject-access` | Generate a scoped subject-access result |
| `GET /reports/complaints?from=&to=&format=` | JSON or CSV complaint register |
| `GET/PUT /configuration/regulatory-profiles` | Regulatory deadline profiles |
| `GET/PUT /configuration/business-hours` | Working-time calendar |
| `GET/PUT /configuration/holidays` | Non-working dates |

## Complaint and deadline flow

At ticket creation, `ComplianceService.applyAtCreation` evaluates the selected kind/category and active regulatory profile. Complaint classification stores structured flags rather than relying on free-text labels. `startClock` calculates acknowledgement and final-response deadlines with [`business-calendar.ts`](../../apps/api/src/compliance/business-calendar.ts), respecting timezone, work windows, weekends and holidays.

Manual classification first loads the ticket and calls ticket-level policy. The service locks the row, updates complaint/systemic/vulnerability/regulatory facts, writes audit evidence and emits the appropriate outbox event. Scheduler reconciliation derives states such as at-risk or overdue from persisted deadlines; it is safe to repeat.

An AFCA/external dispute record is a privileged mutation with strict identifiers/dates. A communication block is checked when creating or delivering communications; recording a flag only in the UI would be unsafe.

## Privacy and reporting

Subject access resolves a reference, applies explicit privacy permission and step-up requirements, then assembles only the approved subject projection. Responses use `Cache-Control: no-store`. Audit records who exported which subject/reference and the outcome, but excludes the exported personal data.

The complaint register requires report permission and limits the date range. JSON supports application use; CSV uses [`csv.ts`](../../apps/api/src/compliance/csv.ts) to quote fields safely and avoid malformed rows/formula injection. Query predicates include the caller's legal-entity/country scope.

## Frontend

Staff manage ticket-level facts in [`compliance-tab.tsx`](../../apps/web/src/features/ticket/tabs/compliance-tab.tsx). Regulatory profiles and calendars are edited in [`compliance-section.tsx`](../../apps/web/src/features/admin/sections/compliance-section.tsx). Dashboard/report actions call dedicated APIs and treat exported files as sensitive; they are not put into React Query's long-lived general cache.

## Tests and interview answer

Test timezone boundaries, weekends, holidays, daylight-saving changes where applicable, reclassification, block enforcement, scheduler idempotency, report scope, CSV escaping, missing step-up and audit minimization. Calendar unit coverage is in [`business-calendar.spec.ts`](../../apps/api/test/business-calendar.spec.ts).

> I implemented compliance rules as structured ticket data plus a business-time deadline service. Creation/classification selects a regulatory profile and calculates deadlines from timezone-aware business hours and holidays. The scheduler only derives status from persisted deadlines and can safely rerun. Privacy exports and complaint reports have separate permissions, scope filters, no-store responses and audit events that record the access without copying the personal data into the audit log.
