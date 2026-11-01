# Configuration backend patterns

[Back to Configuration index](README.md) · Code: [configuration.service.ts](../../apps/api/src/configuration/configuration.service.ts), [configuration.controller.ts](../../apps/api/src/configuration/configuration.controller.ts)

---

## 1. Routes

[configuration.controller.ts#L15-L31](../../apps/api/src/configuration/configuration.controller.ts#L15-L31), all under `/v1/configuration`, guarded:

| Route | Who | Returns |
|---|---|---|
| `GET /queues` | any staff | Active queues **the caller holds**, in their entity and country |
| `GET /categories` | any staff | Active categories whose default queue the caller holds |
| `GET /communication-templates` | `ticket:read` or `configuration:write` | Active templates (Redis-cached 30 s) |
| `GET /communication-templates/all` | administrators | All templates including inactive, with wording |
| `GET /sla` | administrators | All SLA policies |
| `PUT /queues/:key`, `/categories/:key`, `/sla/:policy/:priority`, `/communication-templates/:key` | administrators | Upserts |
| Routing and intake routes | administrators | See [routing admin](../assignment-and-routing/routing-admin.md) |

**Read vs write:** staff read safe, active, scoped lists to fill pickers; administrators read and write everything in their jurisdiction.

## 2. The write pattern (same everywhere)

Example: [upsertCategory, L75-L100](../../apps/api/src/configuration/configuration.service.ts#L75-L100):

```ts
this.policy.assertPermission(user, 'configuration:write');                       // 1 permission
this.assertKey(categoryKey, 80);                                                 // 2 key format ^[a-z0-9][a-z0-9-]*$
return this.db.transaction(async (client) => {
  const previous = await this.audit.previous(client, 'ticket_categories', 'category_key=$1', [categoryKey]);   // 3 before-value
  const queue = SELECT legal_entity,country FROM case_queues WHERE queue_key = dto.defaultQueue;  if (!queue) 409;
  this.assertScope(user, queue.legal_entity, queue.country);                     // 4 jurisdiction
  if (dto.regulatoryProfile) must exist, be active, and match user.country       // 5 references valid
  if (dto.workflowKey) must exist and be active
  INSERT ... ON CONFLICT (category_key) DO UPDATE ...                            // 6 upsert
  await this.audit.write(client, { action: 'configuration.category_updated', metadata: { previous, ... } });   // 7 audit
  await this.outbox.enqueue(client, { eventType: 'configuration.category_changed', ... });                    // 8 event
});
```

| Step | Plain reason |
|---|---|
| Permission | Only administrators |
| Key format | Keys appear in URLs, logs and joins; keep them boring (`premium-cards`) |
| **Before-value** | The audit shows what changed, not just "something changed" |
| Scope | A multi-entity bank's AU administrator can't reconfigure NZ |
| Reference checks | No category pointing at a missing queue, profile or workflow |
| Upsert | `PUT` is idempotent: create or replace |
| Audit + outbox, same client | Evidence and downstream notification atomic with the change |

## 3. Use-time re-validation

[assertTicketSelection, L19-L22](../../apps/api/src/configuration/configuration.service.ts#L19-L22), called by ticket creation:

```sql
SELECT c.category_key FROM ticket_categories c JOIN case_queues q ON q.queue_key = c.default_queue
WHERE c.category_key=$1 AND c.active AND q.queue_key=$2 AND q.department=$3 AND q.legal_entity=$4 AND q.country=$5 AND q.active
```

If an administrator deactivated a queue five minutes ago, a user with an old dropdown still gets a 409. **Configuration is checked when it's used, not just when it's shown.**

## 4. Category options worth knowing

[UpsertCategoryDto](../../apps/api/src/configuration/configuration.dto.ts#L10-L23): `defaultQueue`, `active`, `regulatoryProfile` (makes tickets complaints), `blockCustomerCommunication` (fraud), `resolutionNoticeEnabled` (default true), `workflowKey` (default `standard`), `retentionYears` (1-99, default 7). One row controls routing, compliance, communications, workflow and retention for a case type.

## 5. Caching templates

[communicationTemplates, L48-L56](../../apps/api/src/configuration/configuration.service.ts#L48-L56) reads `configuration:communication-templates:v1` from Redis, falls back to PostgreSQL, and caches for 30 s; `upsertCommunicationTemplate` deletes the key **after** the transaction commits ([L132-L135](../../apps/api/src/configuration/configuration.service.ts#L132-L135)). The `:v1` suffix lets a format change use a new key. Redis down means a cache miss, never an error. See [Cache](../cache/README.md).

## 6. Template upsert keeps wording if omitted

`subject_template=COALESCE(EXCLUDED.subject_template, communication_templates.subject_template)` ([L126](../../apps/api/src/configuration/configuration.service.ts#L126)): toggling "active" without resending the text doesn't wipe the wording.

## 7. Tests

[ticket.integration-spec.ts#L114](../../apps/api/test/ticket.integration-spec.ts#L114): agents get 403 on queue, SLA and template writes; administrators succeed; events are emitted for each; staff can read active templates. Config before-values: [workflow.integration-spec.ts#L247](../../apps/api/test/workflow.integration-spec.ts#L247).

## 8. Limitation

Configuration writes are last-write-wins: two administrators editing the same row don't get a 409. A version column or ETag would add optimistic concurrency.
