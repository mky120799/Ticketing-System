# Producers: who creates which notification, and why

[Back to Notifications index](README.md) · Previous: [Data model and SQL](data-model-and-sql.md) · Next: [Live push](live-push.md)

A **producer** is code that creates notifications. There are eleven call sites in seven services. All of them follow the same rule: **create the notification with the caller's transaction client, after the business change, inside the same transaction.** This page lists them all, explains the audience each chooses, and points out the design decisions hidden in them.

---

## 1. The two entry points

### `create(client, target, type, title, ticketId?)`

The basic call: one notification for one target ([notifications.service.ts#L20-L24](../../apps/api/src/notifications/notifications.service.ts#L20-L24)). The target is either a person:

```ts
{ user: 'subject-id', legalEntity, country }
```

or a role in a queue:

```ts
{ queue: 'payments', role: 'supervisor', legalEntity, country }
```

### `ticketAttention(client, ticket, type, title, options)`

The common helper: "this ticket needs attention" ([L27-L30](../../apps/api/src/notifications/notifications.service.ts#L27-L30)):

```ts
async ticketAttention(client, ticket, type, title, options = { assignee: true, supervisors: true }) {
  if (options.assignee !== false && ticket.assigned_to) await this.create(client, { user: ticket.assigned_to, ... }, type, title, ticket.id);
  if (options.supervisors !== false) await this.create(client, { queue: ticket.queue, role: 'supervisor', ... }, type, title, ticket.id);
}
```

It creates **up to two** notifications: one for the person working the ticket (if anyone is assigned) and one for **the supervisors of the ticket's current queue**. Each can be switched off. Note it takes the **scope from the ticket row** (`legal_entity`, `country`), so supervisors in another entity who happen to have a queue with the same name never match.

`NotificationsModule` is `@Global()` ([notifications.module.ts#L6](../../apps/api/src/notifications/notifications.module.ts#L6)), so any service can inject `NotificationsService` without importing the module.

---

## 2. Every call site

| # | Event | Type | Audience | Runs in | Code |
|---|---|---|---|---|---|
| 1 | Ticket auto-assigned on creation | `ticket_assigned` | the chosen member | the ticket-creation transaction | [assignment.service.ts#L38-L39](../../apps/api/src/tickets/assignment.service.ts#L38-L39) |
| 2 | Ticket manually assigned | `ticket_assigned` | the assignee, if one was chosen | the assign request | [tickets.service.ts#L139](../../apps/api/src/tickets/tickets.service.ts#L139) |
| 3 | Communication needs approval | `approval_needed` | queue supervisors only | the create-communication request | [tickets.service.ts#L301](../../apps/api/src/tickets/tickets.service.ts#L301) |
| 4 | Generic approval requested | `approval_needed` | queue supervisors only | the approval request | [tickets.service.ts#L322](../../apps/api/src/tickets/tickets.service.ts#L322) |
| 5 | Automatic resolution notice needs approval | `approval_needed` | queue supervisors only | the resolve transition | [resolution-notice.service.ts#L55](../../apps/api/src/tickets/resolution-notice.service.ts#L55) |
| 6 | Resolution notice could not be sent | `approval_needed` | assignee **and** supervisors | the resolve transition | [resolution-notice.service.ts#L74](../../apps/api/src/tickets/resolution-notice.service.ts#L74) |
| 7 | SLA breached / first response overdue | `sla_at_risk` | assignee and supervisors | the scheduler's SLA batch | [sla.service.ts#L92](../../apps/api/src/tickets/sla.service.ts#L92) |
| 8 | Complaint at risk, acknowledgement overdue, final response overdue | `regulatory_at_risk` | assignee and supervisors | the scheduler's compliance batch | [compliance.service.ts#L105](../../apps/api/src/compliance/compliance.service.ts#L105) |
| 9 | Customer replied (portal message, portal document, email) | `customer_replied` | assignee; **plus** supervisors if the ticket is resolved or closed | the reply transaction | [customer-reply.service.ts#L40](../../apps/api/src/intake/customer-reply.service.ts#L40) |
| 10 | Ticket escalated | `ticket_escalated` | supervisors of the **target** queue | one transaction per escalated ticket | [escalation.service.ts#L58](../../apps/api/src/workflow/escalation.service.ts#L58) |
| 11 | Ticket escalated | `ticket_escalated` | the **previous** assignee, if any | same | [escalation.service.ts#L59](../../apps/api/src/workflow/escalation.service.ts#L59) |

---

## 3. The decisions behind the audiences

**Approvals go to supervisors only (3, 4, 5).** Maker-checker means the person who asked cannot approve ([auth: maker-checker](../auth/authorization-policy.md)). Notifying the assignee (often the maker) would be noise, so `assignee: false`.

**"Could not be sent" goes to everyone responsible (6).** The resolution notice is how the customer learns their case is resolved. If it cannot be sent (no recipient on file, template inactive), nobody will tell the customer unless a person does, so both the assignee and the supervisors are told ([resolution-notice.service.ts#L73-L74](../../apps/api/src/tickets/resolution-notice.service.ts#L73-L74)). The one exception: when communications are **blocked** on purpose (for example a fraud case, to avoid tipping off), no notification is sent, because silence is the intended outcome.

**Deadlines go to the assignee and supervisors (7, 8).** The person working it should act; the supervisor should know their queue is at risk.

**Customer replies (9)** go to the assignee. If the ticket is already **resolved or closed**, the supervisors are told too: a reply to a closed case may be a complaint about the outcome, and there may be no active assignee looking.

**Escalation tells two different groups (10, 11).** The ticket has *moved*: the **new** queue's supervisors must pick it up, and the **previous** assignee should know it left them. Notice that call 10 passes `updated` (the ticket row after the move, so its `queue` is the target queue) while call 11 uses `ticket` (the row before, so `assigned_to` is the previous assignee). `assignee: false` on call 10 because the escalation cleared `assigned_to` ([escalation.service.ts#L53](../../apps/api/src/workflow/escalation.service.ts#L53)).

**Auto-assignment reads the queue's scope (1).** `autoAssign` receives only the ticket's ID and queue, so it looks up the queue's legal entity and country before notifying ([assignment.service.ts#L38](../../apps/api/src/tickets/assignment.service.ts#L38)). If the queue row were missing, the notification would be skipped rather than written with no scope.

---

## 4. Scheduler producers do not spam

The SLA and compliance reconcilers run every minute. Why does a breached ticket not generate a notification every minute?

Because both reconcilers only touch tickets whose status **changes** on this tick: the update has `AND sla_status IS DISTINCT FROM <new status>` ([sla.service.ts#L86](../../apps/api/src/tickets/sla.service.ts#L86)), and the notification loop iterates over the rows the `UPDATE ... RETURNING *` returned ([L88-L93](../../apps/api/src/tickets/sla.service.ts#L88-L93)). A ticket that became `breached` on one tick is not returned on the next, so it notifies **once per transition**. That is the same guard that stops the job rewriting rows and writing audit events for non-changes ([Database: SQL patterns 15](../database/sql-patterns.md#15-is-distinct-from-null-safe-comparison-and-skipping-no-op-writes)).

The scheduler paths also show why notifications use the producer's client. The SLA batch updates up to 500 tickets in **one** transaction. If the transaction fails half-way, the status changes, the audit events, the outbox events **and** the notifications all roll back together, and the next tick retries the whole batch. A notification can never refer to a breach that was not recorded.

---

## 5. Things to notice (and possible improvements)

| Observation | Why it matters | Improvement |
|---|---|---|
| Call 6 uses the type `approval_needed` for "contact the customer directly", which is not an approval | Anyone filtering or styling by type gets it wrong | A dedicated type such as `action_needed` |
| `type` is a TypeScript union, not a database CHECK | A future producer in another service could write any string | Add a CHECK, like the other enumerations in the schema |
| Titles are fixed English strings | No translation; a title cannot say *which* ticket | Store a type and parameters, render the text in the browser |
| Every producer passes a ticket ID | Non-ticket notifications (for example "your access request was approved") are possible but unused | Nothing needed until a use case appears |
| Producers decide audiences in code | There is no per-user preference (mute "SLA at risk") | A preferences table consulted at read time |

Next: [Live push](live-push.md)
