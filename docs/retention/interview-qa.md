# Retention interview Q&A

[Back to Retention index](README.md)

---

## 30 seconds
> Supervisors set legal holds or retention dates with step-up, and the reason is kept out of audit and events. An opt-in hourly job finds closed tickets past their effective retention date and not on hold, deletes their files idempotently, then under a row lock re-checks eligibility and overwrites every personal field, keeping a reporting skeleton. The audit trail stays because it never held free text. The known gap is the file-delete-before-lock race, which I'd fix with a durable pending-redaction claim.

## Questions

**Q1. Why de-identify instead of deleting rows?**
> Statistics and regulatory reporting (volumes, outcomes, root causes, SLA performance) still need the skeleton. Personal data is what the law requires us to remove.

**Q2. Why doesn't retention touch the audit trail?**
> The audit trail is immutable by design, and we never put customer free text in it: only IDs, classifications, lengths and fingerprints. So it doesn't need redaction.

**Q3. How does a legal hold win?**
> Hold rows are excluded from candidates, and the redaction transaction re-reads the ticket `FOR UPDATE OF t` and skips it if a hold appeared. For database fields that's airtight; for files there's the race below.

**Q4. What's the race?**
> Files are deleted before the locked re-check, so a hold added in between protects the fields but not the files. The fix: lock, re-check and mark `redaction_pending` first, delete files idempotently with retries, then finalise; and block holds on pending rows, or coordinate them.

**Q5. Why is it opt-in?**
> It's destructive. Banks must approve retention schedules before turning it on.

**Q6. How do you make sure downstream copies are erased?**
> A `ticket.redacted` outbox event; consumers must erase their projections idempotently.

## Limitations
1. The cross-store race described above.
2. Old notifications and outbox rows aren't cleaned up.
3. The hourly cadence is tracked in memory.
