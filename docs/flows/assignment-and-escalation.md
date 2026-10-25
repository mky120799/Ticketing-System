# Flow: automatic assignment and SLA escalation

## Creation-time assignment

1. Ticket creation inserts ticket/SLA data in an open transaction.
2. `AssignmentService.autoAssign` takes a transaction advisory lock keyed by queue.
3. It chooses the most specific active assignment rule for queue/category/priority.
4. It selects an active `queue_members` row by least-loaded or round-robin ordering.
5. It updates assignee/status/member timestamp and inserts history/audit/outbox/notification in the original transaction.
6. Commit makes the ticket and its initial assignment visible together.

If no rule/member exists, ticket remains unassigned and creation still succeeds.

## Scheduler escalation

1. Workflow scheduler acquires its global tick advisory lock.
2. SLA/regulatory reconciliation updates derived due states.
3. Escalation service loads active rules and selects at most 100 due candidates per rule.
4. Each candidate gets its own transaction and `tickets FOR UPDATE` recheck.
5. A unique `(ticket_id,rule_key)` insert claims idempotency.
6. Ticket moves queue, clears assignee, optionally raises priority and gets status history/audit/outbox/live/notifications.
7. Old/new staff audiences refetch; users outside new scope lose the cached row.

## Current manual-path distinction

Automatic assignment selects only configured active queue members. Manual assignment currently validates supervisor and target queue but not submitted assignee membership. The Directory picker is not sufficient; backend membership validation is a documented fix.

## Interview answer

> Creation-time assignment is part of the ticket transaction and serialized per queue so simultaneous least-loaded decisions do not all pick the same person. Escalation is a scheduled bounded scan, but every candidate is re-locked and claimed under a unique ticket/rule key before moving. Both produce history, audit, outbox and notifications. I distinguish this safe automatic path from the current manual-assignee validation gap.
