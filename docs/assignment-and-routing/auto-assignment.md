# Auto-assignment

[Back to Assignment index](README.md) · Code: [assignment.service.ts](../../apps/api/src/tickets/assignment.service.ts)

---

## 1. When it runs

Inside the **creation transaction**, for both staff-created tickets ([tickets.service.ts#L56](../../apps/api/src/tickets/tickets.service.ts#L56)) and channel intake ([intake.service.ts#L61](../../apps/api/src/intake/intake.service.ts#L61)). The ticket and its first assignment become visible together at commit.

## 2. The algorithm

[autoAssign, L20-L41](../../apps/api/src/tickets/assignment.service.ts#L20-L41):

```ts
await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`assign:${ticket.queue}`]);     // (1)
const rule = (await client.query(`
  SELECT rule_key, strategy FROM assignment_rules
  WHERE queue_key=$1 AND active=true AND (category IS NULL OR category=$2) AND (priority IS NULL OR priority=$3)
  ORDER BY (category IS NOT NULL) DESC, (priority IS NOT NULL) DESC, sort_order, rule_key LIMIT 1`, [...])).rows[0];  // (2)
if (!rule) return null;
const order = rule.strategy === 'round_robin'
  ? 'm.last_assigned_at NULLS FIRST, m.user_id'
  : 'open_count, m.last_assigned_at NULLS FIRST, m.user_id';                                      // (3)
const member = (await client.query(`
  SELECT m.user_id, (SELECT count(*) FROM tickets t WHERE t.queue=m.queue_key AND t.assigned_to=m.user_id
                     AND t.status NOT IN ('resolved','closed','cancelled')) AS open_count
  FROM queue_members m WHERE m.queue_key=$1 AND m.active=true ORDER BY ${order} LIMIT 1`, [ticket.queue])).rows[0];
if (!member) return null;
UPDATE tickets SET assigned_to, status='assigned'; UPDATE queue_members SET last_assigned_at=now();   // (4)
INSERT ticket_status_history (reason "Auto-assigned by rule X (strategy)", changed_by system:assignment-rules)
audit ticket.auto_assigned · outbox ticket.assigned (mode: auto) · notifications.create(ticket_assigned)   // (5)
```

| Step | Plain explanation |
|---|---|
| (1) **Per-queue advisory lock** | Without it, five tickets created at the same instant could all see "Priya has 2 open, the fewest" and all go to Priya. `hashtext` turns the queue name into the lock number, so different queues assign in parallel |
| (2) **Most specific rule wins** | `(category IS NOT NULL) DESC` puts category-specific rules first, then priority-specific, then `sort_order`. Example: "payments + chargeback + critical → round robin" beats "payments → least loaded" |
| (3) **Strategy = ORDER BY** | Least loaded: fewest open, ties broken by who waited longest, then ID (deterministic). Round robin: whoever was assigned longest ago (`NULLS FIRST` = never assigned goes first) |
| (3) Safe SQL | The `ORDER BY` text comes from a fixed pair of strings in code, never from input (the comment at [L27](../../apps/api/src/tickets/assignment.service.ts#L27) says so) |
| (4) Two updates | Ticket gets the assignee; the member's `last_assigned_at` moves, which drives round robin and least-loaded tie-breaks |
| (5) Evidence | System actor `system:assignment-rules`; the outbox payload includes `mode: 'auto'` and `ruleKey` |

## 3. When nobody is picked

No matching rule, or no active member: return `null`. The ticket stays **unassigned** in the queue (status `submitted`) and creation still succeeds. A supervisor can assign it, or someone can pick it up from the "Unassigned" view.

## 4. Example

Queue `payments` has members Asha (3 open, last assigned 10:00), Ben (1 open, last 10:05) and Chen (1 open, never assigned).

| Strategy | Pick | Why |
|---|---|---|
| least_loaded | **Chen** | Ben and Chen tie on 1 open; Chen's `last_assigned_at` is NULL (first) |
| round_robin | **Chen** | NULL first; next time Asha (10:00), then Ben |

## 5. Notification

The assigned person gets a `ticket_assigned` notification within the creation transaction. The scope comes from the queue's entity and country ([L38-L39](../../apps/api/src/tickets/assignment.service.ts#L38-L39)), and a live "refresh your inbox" hint is pushed after commit.

## 6. Tests

[workflow.integration-spec.ts#L31](../../apps/api/test/workflow.integration-spec.ts#L31): "assigns, escalates, de-duplicates intake and pushes only authorized live events".

## 7. Limitations

- No skills, shift or absence awareness: a member on leave stays eligible until an admin deactivates them.
- `open_count` is a correlated subquery per member: fine for teams of tens, worth an index on `(queue, assigned_to, status)` at scale.
- The lock serialises creations **per queue**, so a flood into one queue assigns one at a time (milliseconds each).

Next: [Manual assignment](manual-assignment.md)
