# Flow: retention redaction

1. Scheduler runs retention only when enforcement flag is enabled and at most hourly.
2. Service selects up to 100 closed/cancelled, not-redacted, due tickets without recorded legal hold.
3. It lists and idempotently deletes associated object-store files.
4. Database transaction re-reads ticket under lock and rechecks state/hold.
5. It replaces ticket subject/description/custom fields, note bodies, references, communication recipients and attachment metadata with redacted values.
6. It sets `redacted_at`, writes system audit and enqueues `ticket.redacted`.
7. Ticket remains as reporting-safe skeleton; future mutations reject redacted state.

## Current cross-store race

Step 3 occurs before the locked hold recheck. A hold added between candidate selection and step 4 can make the database transaction skip while bytes were already deleted. PostgreSQL and object storage cannot share one transaction, but this ordering does not fully honor a last-moment hold.

The hardening design is a durable state machine:

```text
eligible --locked claim/recheck--> redaction_pending
  -> idempotent external deletes with retry records
  -> locked final eligibility/finalize database redaction
  -> redacted
```

Legal-hold changes must coordinate with/forbid a pending claim according to policy, and operators need stuck-pending metrics/runbook.

## Interview answer

> Retention is a bounded idempotent background process that removes object bytes and de-identifies every personal field while preserving reporting structure and minimized audit. I would explicitly disclose the current delete-before-lock race and propose a durable pending-redaction state machine so a legal hold and external deletion are coordinated and recoverable.
