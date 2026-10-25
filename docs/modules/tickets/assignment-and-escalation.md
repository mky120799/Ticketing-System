# Tickets: assignment and escalation

Assignment puts new/existing tickets with people or queues. Escalation moves overdue tickets according to configured rules. Both operate on scope/configuration data, but automatic and manual paths currently have different validation strength.

## Automatic assignment

[`AssignmentService.autoAssign`](../../../apps/api/src/tickets/assignment.service.ts) receives the creation transaction client. It first acquires `pg_advisory_xact_lock(hashtext('assign:' + queue))`, serializing selection for one queue while allowing different queues in parallel.

It selects the most specific active `assignment_rules` row: category-specific before generic, priority-specific before generic, then sort order/key. Supported strategies:

- `least_loaded`: active member with fewest non-terminal assigned tickets, then oldest `last_assigned_at`, then id;
- `round_robin`: oldest/null `last_assigned_at`, then id.

If no rule/member exists, creation remains unassigned without failing. A selection updates `tickets.assigned_to/status`, member `last_assigned_at`, status history, system audit/outbox and direct notification—all in the creation transaction.

## Manual assignment

`TicketsService.assign` requires supervisor `ticket:assign`, source-ticket access, expected timestamp and target queue in the supervisor's queues. It updates queue, optional assignee and status, writes evidence/live event, and notifies the submitted subject.

Current gap: it does not query `queue_members` or `staff_directory` to prove that `assigneeId` exists, is active, belongs to the target queue and jurisdiction, or has a case-working role. A user can alter the request beyond the Directory picker. Fix this inside the transaction before update; add a foreign/reference model if identity lifecycle permits.

The same mutation also has the general non-atomic `expectedUpdatedAt` limitation documented in [mutations and concurrency](mutations-workflow-and-concurrency.md).

## Escalation candidate selection

[`EscalationService`](../../../apps/api/src/workflow/escalation.service.ts) loads active `escalation_rules`. Trigger SQL comes only from a fixed code map—first-response overdue, regulatory acknowledgement/risk/breach, or resolution breach—so configuration cannot inject SQL.

For each rule it selects at most 100 candidates in source queue, verifies target queue has matching entity/country and excludes an existing `(ticket_id, rule_key)` escalation.

## Escalate-one transaction

Each candidate gets its own transaction:

1. Re-read ticket `FOR UPDATE` and confirm it is still in the source queue.
2. Insert `ticket_escalations` with `ON CONFLICT ... DO NOTHING`.
3. If claimed, move to target queue, clear assignee, set `escalated` and optionally raise priority one step.
4. Insert status history with `system:escalation`.
5. Write audit/outbox and live notification.
6. Notify target supervisors and the former assignee.

The unique ticket/rule key makes repeated scheduler ticks idempotent. Re-reading under lock closes the candidate-selection race for a user who resolved/moved the ticket.

## Frontend/admin

Supervisors use `assign-modal.tsx` with scoped queue and Directory data. Administrators configure queue members and assignment/escalation rules in `routing-section.tsx`. A live event refreshes the old and new queue audiences; a user who loses scope gets 403/404 on refetch and the cache removes the row.

## Tests and interview answer

Test no rule/member, specificity, least-loaded ties, round robin, same-queue concurrency, manual invalid assignee, stale manual assignment, escalation trigger, target-scope compatibility, last-moment resolution and duplicate scheduler ticks.

> Auto-assignment runs in the ticket transaction and serializes decisions per queue with an advisory lock. It selects a configured strategy over active queue members and records assignment/history/audit/outbox/notification atomically. Escalation selects bounded candidates, re-locks each ticket and claims a unique ticket/rule record before moving it. I would explicitly flag that the current manual assignment path still needs in-transaction assignee membership validation.
