# Routing administration

How administrators configure who receives work and where overdue work goes. Administrators **never** see ticket content.

[Back to Assignment index](README.md) · Code: [routing.service.ts](../../apps/api/src/configuration/routing.service.ts)

---

## 1. API

All under `/v1/configuration`, guarded, `configuration:write` ([configuration.controller.ts#L24-L31](../../apps/api/src/configuration/configuration.controller.ts#L24-L31)):

| Route | Service | Scope rule |
|---|---|---|
| `GET /queues/:queueKey/members` | `listMembers` [L15-L20](../../apps/api/src/configuration/routing.service.ts#L15-L20) | queue in the admin's entity/country |
| `PUT /queues/:queueKey/members/:userId` `{active}` | `upsertMember` [L36-L47](../../apps/api/src/configuration/routing.service.ts#L36-L47) | userId pattern `^[A-Za-z0-9._:@-]{1,160}$`; queue in scope |
| `GET /assignment-rules` | `listAssignmentRules` [L22-L27](../../apps/api/src/configuration/routing.service.ts#L22-L27) | joined to queues in scope |
| `PUT /assignment-rules/:ruleKey` | `upsertAssignmentRule` [L49-L67](../../apps/api/src/configuration/routing.service.ts#L49-L67) | queue in scope, category active, existing rule owned in scope |
| `GET /escalation-rules` | [L29-L34](../../apps/api/src/configuration/routing.service.ts#L29-L34) | joined to queues in scope |
| `PUT /escalation-rules/:ruleKey` | [L69-L85](../../apps/api/src/configuration/routing.service.ts#L69-L85) | both queues in scope, not self |

Intake channels are also in this service; see [Intake](../intake/README.md).

## 2. The repeated save pattern

```ts
this.policy.assertPermission(user, 'configuration:write');
this.assertKey(ruleKey);                                       // ^[a-z0-9][a-z0-9-]*$, 2..80
return this.db.transaction(async (client) => {
  const previous = await this.audit.previous(client, 'assignment_rules', 'rule_key=$1', [ruleKey]);  // before-value
  await this.assertQueueInScope(client, user, dto.queue);      // exists, active, same entity+country
  await this.assertRuleOwnedInScope(client, user, 'assignment_rules', ruleKey);  // can't hijack another entity's rule
  INSERT ... ON CONFLICT (rule_key) DO UPDATE ...              // upsert
  await this.record(client, user, correlationId, 'assignment_rule', ..., { ...view, previous });  // audit + outbox
});
```

`record()` ([L129-L132](../../apps/api/src/configuration/routing.service.ts#L129-L132)) writes `configuration.<kind>_updated` audit and `configuration.<kind>_changed` outbox events with the same client.

**Why scope checks on configuration?** A multi-entity bank (say AU and NZ) may share one platform. An AU administrator must not be able to reroute NZ queues, even by guessing a rule key. That's why `assertRuleOwnedInScope` exists ([L120-L123](../../apps/api/src/configuration/routing.service.ts#L120-L123)).

## 3. Frontend

[routing-section.tsx](../../apps/web/src/features/admin/sections/routing-section.tsx), three cards built with the shared [admin-kit](../configuration/frontend.md):

| Card | Lines | Highlights |
|---|---|---|
| Queue members | [L21-L63](../../apps/web/src/features/admin/sections/routing-section.tsx#L21-L63) | Pick by **name** from the directory; falls back to typing a subject ID if nobody has signed in yet; Activate/Deactivate toggle |
| Assignment rules | [L65-L109](../../apps/web/src/features/admin/sections/routing-section.tsx#L65-L109) | Table sorted by order; editor for queue/category/priority/strategy/order |
| Escalation rules | [L111-L154](../../apps/web/src/features/admin/sections/routing-section.tsx#L111-L154) | From → to queue, trigger, "Raise priority one step" |

## 4. Interview answer

> Routing is configuration as data: queue members, assignment rules and escalation rules, editable by administrators who have no case access. Every save checks permission and key format, checks that referenced queues exist, are active and are in the administrator's entity and country, prevents editing another entity's rule, and upserts with the previous row recorded in audit plus an outbox event, all in one transaction.

Next: [Interview Q&A](interview-qa.md)
