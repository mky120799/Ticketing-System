# Assignment and routing interview Q&A

[Back to Assignment index](README.md)

---

## 30 seconds
> New tickets are auto-assigned inside the creation transaction under a per-queue advisory lock: the most specific active rule picks least-loaded or round-robin over active queue members. Supervisors can reassign within their queues. A scheduler escalates overdue tickets per rule, re-locking each ticket and claiming a unique ticket-rule row so it happens at most once, and notifies the right people.

## Questions

**Q1. How do you stop two simultaneous tickets both going to the "least loaded" person?**
> `pg_advisory_xact_lock(hashtext('assign:' || queue))` serialises assignment decisions per queue for the rest of the transaction. The second creation sees the first one's assignment in the open-count.

**Q2. Why an advisory lock rather than locking member rows?**
> The decision reads aggregates (open counts) across many rows; locking the abstract "queue assignment" is simpler and exactly as wide as needed. Other queues aren't blocked.

**Q3. How does rule specificity work?**
> `ORDER BY (category IS NOT NULL) DESC, (priority IS NOT NULL) DESC, sort_order, rule_key`. Specific beats generic, then the admin's explicit order, then a deterministic tie-break.

**Q4. What if no one is available?**
> The ticket stays unassigned in the queue; creation never fails because of routing.

**Q5. How is escalation idempotent?**
> `INSERT INTO ticket_escalations ... ON CONFLICT (ticket_id, rule_key) DO NOTHING RETURNING id`. Only the transaction that gets a row back proceeds, and that holds across ticks and instances.

**Q6. Why re-read the ticket with `FOR UPDATE` before escalating?**
> The candidate list was read moments earlier without locks; someone may have resolved or moved the ticket. Re-checking under a row lock closes that race.

**Q7. Can configuration inject SQL into the escalation query?**
> No. Triggers are an enum validated by the DTO, mapped to fixed SQL fragments in code.

**Q8. What's weak today?**
> Manual assignment doesn't validate the assignee against active queue membership. The UI picker is not a security control, so I'd add an in-transaction membership query and a test.

## Honest limitations
1. Manual assignee not validated.
2. No skills, shift or absence awareness.
3. Automatic moves don't consult workflow edges.
4. The UI exposes only 2 of 5 escalation triggers.
