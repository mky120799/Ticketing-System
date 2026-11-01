# SLA interview Q&A

[Back to SLA index](README.md)

---

## 30 seconds
> Each ticket gets two deadlines at creation from the active policy for its priority, in wall-clock or business minutes using a time-zone-aware calendar. They're stored on the ticket. Waiting on the customer can pause the clock and resuming shifts the deadlines. A scheduler re-derives the SLA status with one SQL `CASE` in skip-locked batches, recording audit, outbox, live hints and supervisor notifications for each change, and escalation rules act on the result.

## 2 minutes
> `SlaService.calculate` runs inside the create transaction. It loads the `default` policy for the priority, failing with 409 if none is active, and for a business calendar loads the country's working hours and holidays and calls `addBusinessMinutes`. The deadlines are persisted, so policy edits don't change existing promises. First response is set once by the first customer-facing action: a customer note, a queued communication, pending-customer or resolve. Customer replies never count. Entering `pending_customer` sets `sla_paused_at` if the policy allows; leaving it adds the paused interval to both deadlines in one UPDATE. The status formula is one SQL string: paused, then breached, then first-response overdue, then met, then running. The timer variant updates at most 500 rows whose status would change, with `FOR UPDATE SKIP LOCKED`, under the scheduler's advisory lock. The manual variant is scoped: administrators see the entity, supervisors their queues.

## Questions

**Q1. Why store deadlines instead of computing them on read?**
> Because the promise is made at creation. If an administrator changes the policy, existing tickets keep their original obligations, and reporting stays reproducible. It also makes overdue queries index-friendly.

**Q2. Why compute status in SQL?**
> One definition, evaluated with the database clock, inside the UPDATE that also filters "would change". No application/database clock skew, and no per-row round trips.

**Q3. How do you avoid hammering the database every minute?**
> `IS DISTINCT FROM` means only rows whose status changes are touched, at most 500 per tick, with skip-locked selection. A quiet system does almost nothing.

**Q4. What if two API instances run the scheduler?**
> The scheduler takes `pg_try_advisory_xact_lock(804232)`; only one instance runs a tick. Even without it, `SKIP LOCKED` gives disjoint batches and the "would change" filter makes reruns no-ops.

**Q5. How does business-hours math handle daylight saving?**
> It works in local wall time through `Intl` with IANA zones, converts back to an instant by iterating on the offset, and takes weekdays from the calendar date at noon UTC.

**Q6. Can a customer stop the clock by replying?**
> No. Customer replies are stored as customer-authored notes and explicitly don't set `first_responded_at`. They move a waiting ticket back to in progress and resume the clock.

**Q7. Why does breach take precedence over first-response overdue?**
> Resolution is the bigger obligation; showing "breached" is the most actionable. The response lateness is still visible from the timestamps.

## Honest limitations

1. Business policy without a country calendar silently uses wall-clock minutes → reject at configuration.
2. Pause shifts by wall-clock time even for business policies → recompute remaining business minutes on resume.
3. Only `policy_key='default'` is used → per-category or per-segment policies would need a selection rule.
4. Reconciliation granularity is the tick (60 s) → deadlines are flagged up to a minute late.
