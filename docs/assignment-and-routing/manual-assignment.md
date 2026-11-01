# Manual assignment

[Back to Assignment index](README.md)

---

## 1. Backend

`POST /v1/tickets/:ticketId/assignments` → [tickets.service.ts#L131-L142](../../apps/api/src/tickets/tickets.service.ts#L131-L142):

```ts
const ticket = await this.ticket(client, ticketId);
this.policy.assertTicketAccess(user, ticket, 'ticket:assign');       // supervisors only, in scope
this.assertFresh(ticket, dto.expectedUpdatedAt);                    // stale view → 409
if (!user.queues.includes(dto.queue)) throw new ForbiddenException('Target queue is outside your scope');
UPDATE tickets SET queue=$1, assigned_to=$2 (or NULL), status='assigned', updated_at=now()
audit ticket.assigned { fromQueue, toQueue, fromAssignee, toAssignee, fromStatus }
outbox ticket.assigned
live.notify('ticket.assigned', updated, previousQueue = ticket.queue)  // old AND new queue audiences refresh
if (dto.assigneeId) notifications.create(assignee, 'ticket_assigned')
```

| Detail | Why |
|---|---|
| `ticket:assign` | Supervisor permission ([policy matrix](../auth/authorization-policy.md#3-role--permission-map)) |
| Target queue must be one of the supervisor's | A supervisor can't push work into teams they don't run |
| Leaving `assigneeId` empty | Returns the ticket to the queue's pool |
| `previousQueue` passed to `live.notify` | People watching the **old** queue get a hint too, so their list drops the row ([live-events.service.ts#L46](../../apps/api/src/live/live-events.service.ts#L46)) |
| Audit has from/to | Full movement history for an auditor |

DTO: [AssignTicketDto, ticket.dto.ts#L36](../../apps/api/src/tickets/ticket.dto.ts#L36): `queue` 2-80, optional `assigneeId` 3-160, optional `expectedUpdatedAt`.

## 2. Frontend

[assign-modal.tsx#L17-L66](../../apps/web/src/features/ticket/assign-modal.tsx#L17-L66):

- Queue select from the supervisor's own `/me` queues.
- Assignee **picked by name** from `GET /directory/people?queue=` (case agents and supervisors in scope who hold that queue) ([L28](../../apps/web/src/features/ticket/assign-modal.tsx#L28)).
- The current assignee is kept selectable even if they're not in the list, and "Assign to me" is always possible ([L30-L37](../../apps/web/src/features/ticket/assign-modal.tsx#L30-L37)).
- Sends `expectedUpdatedAt`; success toast "Assigned to <name>" or "Returned to the <queue> queue".
- The ticket still stores the **subject ID**; the name is display only.

## 3. The known gap: the assignee is not validated

The API checks the **supervisor** and the **target queue**, but **not** that `assigneeId`:
- exists in the staff directory,
- is an **active member** of the target queue,
- is in the same legal entity and country,
- has a case-working role, or
- could actually open the ticket under policy.

The picker only shows valid people, but a crafted request can send any string. That's why we say **the UI is not a security boundary**.

### The fix

Inside the same transaction, before the UPDATE:

```sql
SELECT 1 FROM queue_members m
JOIN staff_directory d ON d.subject = m.user_id
WHERE m.queue_key = $queue AND m.user_id = $assignee AND m.active = true
  AND d.legal_entity = $entity AND d.country = $country
  AND d.roles && ARRAY['case-agent','supervisor']
-- no row → 409 "Assignee is not an active member of that queue"
```

Then add an integration test that posts a random subject and expects the refusal.

## 4. Interview answer

> Manual assignment is a supervisor-only mutation. It checks ticket scope, the stale version and that the target queue is one of theirs, then updates queue, assignee and status, with audit containing from/to values, an outbox event, live hints to both the old and new queue audiences, and a notification to the assignee. The UI picks people by name from a scoped directory endpoint. I'd call out that the backend doesn't yet validate the submitted assignee against active queue membership. The fix is one query in the same transaction, plus a test.

Next: [Escalation](escalation.md)
