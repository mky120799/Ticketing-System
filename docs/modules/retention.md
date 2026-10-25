# Retention module

Retention de-identifies closed work after its configured retention period while preserving a non-personal statistical skeleton and immutable audit evidence. Its policy is that legal hold wins over scheduled deletion; the current object-store ordering caveat is documented below.

There is no standalone `RetentionModule`. [`RetentionService`](../../apps/api/src/retention/retention.service.ts) is registered by [`WorkflowModule`](../../apps/api/src/workflow/workflow.module.ts) and invoked by `WorkflowScheduler`. This is why a source-module inventory lists it under Workflow while the domain documentation remains separate.

## Eligibility

[`RetentionService`](../../apps/api/src/retention/retention.service.ts) runs as `system:retention` from the Workflow scheduler only when `RETENTION_ENFORCEMENT_ENABLED=true`, at most hourly. It selects at most 100 candidates where:

- status is `closed` or `cancelled`;
- `closed_at` exists and `redacted_at` is absent;
- no legal hold is active;
- effective retention date is due.

The effective date is a supervisor-set `retention_until` override when present, otherwise `closed_at + ticket_categories.retention_years`.

## Redaction algorithm

For each candidate, the service first lists and idempotently deletes attachment objects. If object deletion fails, it leaves database personal data unchanged so the next run can retry; it does not claim successful erasure while bytes remain.

It then starts a database transaction and re-reads the ticket `FOR UPDATE`. This closes the race where a supervisor places a legal hold or reopens the ticket after candidate selection. Ineligible rows are skipped.

Eligible rows are de-identified across the aggregate:

- ticket subject/description become `[redacted]` and custom fields become `{}`;
- note bodies and opaque/masked references are replaced;
- communication recipient references are removed;
- attachment filenames and checksums are removed;
- `redacted_at` records completion.

Ids, category, dates, status, outcome and root cause remain for aggregate reporting. The transaction writes `ticket.redacted` audit evidence containing only attachment count and enqueues a minimized `ticket.redacted` event.

## Frontend and manual controls

[`retention-tab.tsx`](../../apps/web/src/features/ticket/tabs/retention-tab.tsx) lets authorized staff set a retention date/legal hold through the Tickets API. The backend checks ticket scope and retention permission. The UI must distinguish a hold from a date and cannot offer a way to force scheduler redaction.

After redaction, normal detail projections must not reconstruct personal data from references, notes, communications or attachment metadata. External consumers receiving `ticket.redacted` should erase their corresponding personal projection idempotently.

## Failure model and current race to know

Object storage and PostgreSQL cannot share one transaction. The chosen order favors not declaring redaction complete before byte deletion; idempotent deletes make retry safe. Test due/not-due rows, category defaults, override dates, last-moment legal hold/reopen, repeated runs, partial object failure, all field redactions and audit/outbox atomicity.

There is an important race in the current implementation: attachment objects are deleted before the ticket is locked and legal hold is rechecked. If a supervisor adds a hold between candidate selection and the locked recheck, the database redaction is skipped but the objects may already be gone. Production code should first claim the candidate under lock (or record a durable “redaction pending” reservation), recheck the hold, then perform idempotent external deletion and finalize database redaction through a recoverable state machine. The existing test plan must include this race; documentation must not claim the present implementation fully closes it.

## Interview answer

> I implemented retention as a bounded background job that selects due closed tickets, deletes object bytes idempotently, then locks/rechecks and de-identifies personal database fields with audit/outbox evidence. I would also call out the current cross-store race: deletion precedes the locked legal-hold recheck, so the production-hardening change is a durable pending-redaction state machine that claims eligibility first, supports retries, and finalizes only after external deletion.
