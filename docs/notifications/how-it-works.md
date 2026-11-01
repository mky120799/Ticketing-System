# How notifications work

[Back to Notifications index](README.md) · Code: [notifications.service.ts](../../apps/api/src/notifications/notifications.service.ts)

---

## 1. Data model

[migration 1710000022000#L14-L36](../../apps/api/migrations/1710000022000_notifications_and_email.cjs#L14-L36):

| Column | Meaning |
|---|---|
| `recipient_user` | One person's IdP subject, **or** NULL |
| `recipient_queue` + `audience_role` | Everyone with that role who holds that queue, **or** NULL |
| `legal_entity`, `country` | Scope for queue audiences |
| `type` | `ticket_assigned`, `approval_needed`, `sla_at_risk`, `regulatory_at_risk`, `ticket_escalated`, `customer_replied` |
| `ticket_id` | Opaque link (cascade delete) |
| `title` | ≤ 160 characters, **no customer content** |

`CHECK (recipient_user IS NOT NULL OR (recipient_queue IS NOT NULL AND audience_role IS NOT NULL))`: a notification must have an audience.

`notification_reads(notification_id, user_id, read_at)` with PK `(notification_id, user_id)`: **read state per person**.

---

## 2. Creating

[create(), L20-L24](../../apps/api/src/notifications/notifications.service.ts#L20-L24):

```ts
async create(client: PoolClient, target, type, title, ticketId?) {
  if (!target.user && !(target.queue && target.role)) return;
  await client.query('INSERT INTO notifications (...) VALUES (...)', [...]);
  await this.live.notifyPerson(client, target);   // pg_notify: delivered only after COMMIT
}
```

It takes the caller's **transaction client**: the notification exists if and only if the event that caused it committed.

`ticketAttention` ([L27-L30](../../apps/api/src/notifications/notifications.service.ts#L27-L30)) is the common helper: notify the assignee (if any) **and** the queue's supervisors, each optional.

### Who creates which notification

| Event | Type | Audience | Code |
|---|---|---|---|
| Auto-assigned | `ticket_assigned` | the assignee | [assignment.service.ts#L38-L39](../../apps/api/src/tickets/assignment.service.ts#L38-L39) |
| Manually assigned | `ticket_assigned` | the assignee | [tickets.service.ts#L139](../../apps/api/src/tickets/tickets.service.ts#L139) |
| Approval requested | `approval_needed` | queue supervisors | [tickets.service.ts#L301](../../apps/api/src/tickets/tickets.service.ts#L301), [L322](../../apps/api/src/tickets/tickets.service.ts#L322) |
| Resolution notice needs approval / couldn't be sent | `approval_needed` | supervisors (+ assignee if it couldn't be sent) | [resolution-notice.service.ts#L55](../../apps/api/src/tickets/resolution-notice.service.ts#L55), [L74](../../apps/api/src/tickets/resolution-notice.service.ts#L74) |
| SLA breached / response overdue | `sla_at_risk` | assignee + supervisors | [sla.service.ts#L92](../../apps/api/src/tickets/sla.service.ts#L92) |
| Complaint at risk / overdue | `regulatory_at_risk` | assignee + supervisors | [compliance.service.ts#L105](../../apps/api/src/compliance/compliance.service.ts#L105) |
| Escalated | `ticket_escalated` | target supervisors + previous assignee | [escalation.service.ts#L58-L59](../../apps/api/src/workflow/escalation.service.ts#L58-L59) |
| Customer replied | `customer_replied` | assignee (+ supervisors if resolved/closed) | [customer-reply.service.ts#L40](../../apps/api/src/intake/customer-reply.service.ts#L40) |

---

## 3. Reading: the audience SQL

[audienceSql, L50-L52](../../apps/api/src/notifications/notifications.service.ts#L50-L52):

```sql
(n.recipient_user = $1                                          -- addressed to me
 OR (n.recipient_queue = ANY($4::text[])                        -- or to a queue I hold
     AND n.audience_role = ANY($5::text[])                      -- with a role I have
     AND n.legal_entity = $2 AND n.country = $3))               -- in my entity and country
```

Parameters come from the verified `UserContext` (subject, entity, country, queues, roles). **The audience is evaluated at read time**, so if you leave the payments queue you stop seeing payments-supervisor notifications.

[inbox, L32-L38](../../apps/api/src/notifications/notifications.service.ts#L32-L38) lists the latest (≤ 100) with a `LEFT JOIN notification_reads ... AND r.user_id = me` to compute `read`, plus `unreadCount`.

[markRead, L45-L47](../../apps/api/src/notifications/notifications.service.ts#L45-L47):

```sql
INSERT INTO notification_reads (notification_id, user_id)
SELECT n.id, $1 FROM notifications n LEFT JOIN notification_reads r ON ... AND r.user_id=$1
WHERE r.read_at IS NULL AND <audience> AND ($6::boolean OR n.id = ANY($7::uuid[]))
ON CONFLICT DO NOTHING
```

| Detail | Plain reason |
|---|---|
| `INSERT ... SELECT` with the audience filter | You can only mark notifications **you can see** as read; you can't mark someone else's by guessing IDs |
| `$6 = all` flag | "Mark all read" with one statement |
| `ON CONFLICT DO NOTHING` | Double-click safe (idempotent) |
| Per-user rows | One supervisor reading doesn't clear it for the others |

Controller ([notifications.controller.ts#L14-L15](../../apps/api/src/notifications/notifications.controller.ts#L14-L15)) requires `ticket:read`, so administrators (no case access) get no notifications. `MarkReadDto` limits `ids` to ≤ 100 UUIDs ([L8](../../apps/api/src/notifications/notifications.controller.ts#L8)).

---

## 4. Live push

`notifyPerson` sends `{ kind: 'person', user | queue+role, legalEntity, country }` on the `ticket_live` channel ([live-events.service.ts#L51-L54](../../apps/api/src/live/live-events.service.ts#L51-L54)). Each API instance's listener matches its connected subscribers ([L110-L116](../../apps/api/src/live/live-events.service.ts#L110-L116)) and sends an SSE `event: notification` with an **empty** payload. The browser just refetches. See [Live updates](../live-updates/README.md).

---

## 5. The bell (frontend)

[notification-menu.tsx#L17-L68](../../apps/web/src/layout/notification-menu.tsx#L17-L68):

```ts
const { data } = useQuery({ queryKey: queryKeys.notifications, queryFn: () => getNotifications(user) });  // no polling
const markRead = useMutation({ mutationFn: (ids?) => markNotificationsRead(user, ids), onSuccess: () => invalidate(notifications) });
const open = (ticketId, id) => { close(); markRead.mutate([id]); if (ticketId) navigate(`/tickets/${ticketId}`); };
```

- Refreshed by SSE (`onNotification` → invalidate, [use-live-updates.ts#L25](../../apps/web/src/live/use-live-updates.ts#L25)), so there is **no polling**.
- Badge "99+" cap; the accessible label "Notifications, N unread".
- Only rendered for case workers ([app-layout.tsx#L61](../../apps/web/src/layout/app-layout.tsx#L61)).
- Opening navigates to the ticket, which loads through `GET /tickets/:id` with full policy. If access changed since, the user sees "not available".

## 6. Test

[workflow.integration-spec.ts#L236](../../apps/api/test/workflow.integration-spec.ts#L236): the assignee sees `ticket_assigned`; another agent sees 0 unread; supervisors see SLA/escalation notices; "mark all read" clears the agent's count but **not** the supervisor's.

## 7. Limitations
- No retention or cleanup of old notifications yet (they cascade-delete with tickets only).
- No user preferences (mute types), and no email/Teams fan-out.
