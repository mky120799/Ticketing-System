# Configuration: the bank's rules as data

> **Configuration as data**: queues, categories, SLA policies, message templates, routing rules, intake channels, workflows, regulatory profiles, business hours and holidays live in database tables that administrators edit through the console. They are not environment variables or code.
> In plain words: each bank sets up its own teams, case types, deadlines and letters without waiting for a software release. Every change is audited with its before-value and announced as an event.

Administrators can edit configuration but **cannot read cases**. That's separation of duties ([auth](../auth/authorization-policy.md#3-role--permission-map)).

## Map of configuration areas

| Area | Tables | Backend | Admin UI section | Topic doc |
|---|---|---|---|---|
| Queues | `case_queues` | [configuration.service.ts#L58-L73](../../apps/api/src/configuration/configuration.service.ts#L58-L73) | (API only today) | this folder |
| Categories | `ticket_categories` | [L75-L100](../../apps/api/src/configuration/configuration.service.ts#L75-L100) | (API only today) | this folder |
| SLA policies | `sla_policies` | [L102-L117](../../apps/api/src/configuration/configuration.service.ts#L102-L117) | Service levels | [SLA](../sla/how-it-works.md#6-administration) |
| Message templates | `communication_templates` | [L119-L136](../../apps/api/src/configuration/configuration.service.ts#L119-L136) | Message templates | [Communications](../communications/frontend.md#2-template-editor-administrators) |
| Queue members, assignment & escalation rules | `queue_members`, `assignment_rules`, `escalation_rules` | [routing.service.ts](../../apps/api/src/configuration/routing.service.ts) | Routing | [Routing admin](../assignment-and-routing/routing-admin.md) |
| Intake channels | `intake_channels` | [routing.service.ts#L87-L111](../../apps/api/src/configuration/routing.service.ts#L87-L111) | Intake channels | [Intake](../intake/channel-intake.md#4-channel-configuration) |
| Workflows | `workflow_definitions`, `workflow_transitions` | [workflow-definition.service.ts](../../apps/api/src/workflow/workflow-definition.service.ts) | Workflows | [Workflow](../workflow/definitions.md) |
| Regulatory profiles, business hours, holidays | `regulatory_profiles`, `business_hours`, `business_holidays` | [compliance.service.ts#L149-L208](../../apps/api/src/compliance/compliance.service.ts#L149-L208) | Compliance + Service levels | [Compliance](../compliance/regulatory-clocks.md) |
| Outbox operations | `integration_outbox` | [outbox-admin.service.ts](../../apps/api/src/operations/outbox-admin.service.ts) | Integration events | [Outbox](../outbox/receipts-and-operations.md) |

## Read in this order

1. [Backend patterns](backend.md): permission, scope, key validation, previous-value audit, upsert, outbox, cache invalidation, and use-time re-validation.
2. [Frontend (admin console)](frontend.md): `admin-kit`, URL-addressed sections, editor modals.
3. [Interview Q&A](interview-qa.md)

## 30-second answer

> Configuration is domain data. Every write checks `configuration:write`, validates the key format, checks that referenced queues and categories exist, are active and belong to the administrator's legal entity and country, records the previous row in the audit event, upserts, and enqueues a change event, all in one transaction. The things that use configuration (ticket creation, intake, assignment) re-validate it at use time, so a stale dropdown can never bypass a rule. A Redis cache holds the staff template list for 30 seconds and is invalidated on save.

## Related

[Auth](../auth/README.md) · [Audit (before-values)](../audit/event-model.md#6-before-values-for-configuration-changes) · [Outbox](../outbox/README.md) · [Cache](../cache/README.md)
