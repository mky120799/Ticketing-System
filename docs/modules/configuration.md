# Configuration module

Configuration owns case queues, categories, SLA policies, communication templates, queue membership, assignment rules, escalation rules and intake-channel routing. These values are operational domain data: changing them can alter authorization scope, deadlines and routing, so writes are guarded and audited like business mutations.

## Wiring and API groups

[`ConfigurationModule`](../../apps/api/src/configuration/configuration.module.ts) imports Auth, registers [`ConfigurationController`](../../apps/api/src/configuration/configuration.controller.ts), `CaseConfigurationService` and `RoutingConfigurationService`, and exports `CaseConfigurationService` for Tickets and Intake.

All endpoints use `AuthGuard`. Read/write groups are:

| Resource | Routes |
|---|---|
| Queues | `GET /configuration/queues`, `PUT /configuration/queues/:queueKey` |
| Categories | `GET /configuration/categories`, `PUT /configuration/categories/:categoryKey` |
| SLA | `GET /configuration/sla`, `PUT /configuration/sla/:policyKey/:priority` |
| Templates | `GET /configuration/communication-templates`, `GET .../all`, `PUT .../:templateKey` |
| Members | `GET/PUT /configuration/queues/:queueKey/members/:userId` |
| Assignment | `GET /configuration/assignment-rules`, `PUT .../:ruleKey` |
| Escalation | `GET /configuration/escalation-rules`, `PUT .../:ruleKey` |
| Intake | `GET /configuration/intake-channels`, `PUT .../:channel` |

## Service responsibilities

[`CaseConfigurationService`](../../apps/api/src/configuration/configuration.service.ts) lists active options for normal workflows and full records for administrators. `assertTicketSelection` verifies that a queue and category are active, belong to the requested legal entity/country and form a valid selection before ticket creation or movement.

SLA policy selection uses a policy key plus priority and feeds `SlaService`; communication templates carry controlled content and metadata used when creating outbound communications. Normal template listing exposes only usable active records, while the `/all` administration endpoint includes disabled records for editing.

[`RoutingConfigurationService`](../../apps/api/src/configuration/routing.service.ts) owns `queue_members`, `assignment_rules`, `escalation_rules` and `intake_channels`. It checks the administrator's own configuration scope so a regional administrator cannot silently configure another legal entity. References such as source/target queues must exist and have compatible scope.

## Update transaction pattern

An upsert follows the same shape across resources:

1. Assert `configuration:write` and any required legal-entity/country scope.
2. Validate the path key and DTO bounds/enums.
3. Read a bounded previous representation with `AuditService.previous`.
4. `INSERT ... ON CONFLICT ... DO UPDATE` the configuration row.
5. Write a `configuration.*_updated` audit event with safe before/after facts.
6. Enqueue a `configuration.*_changed` event using the same database client.

This gives operators proof of who changed routing and lets downstream caches/consumers refresh without dual-write risk.

## Frontend administration

[`admin-page.tsx`](../../apps/web/src/features/admin/admin-page.tsx) composes sections for [routing](../../apps/web/src/features/admin/sections/routing-section.tsx), [service levels](../../apps/web/src/features/admin/sections/service-levels-section.tsx), [templates](../../apps/web/src/features/admin/sections/templates-section.tsx), [workflow](../../apps/web/src/features/admin/sections/workflows-section.tsx) and [intake](../../apps/web/src/features/admin/sections/intake-section.tsx). Shared controls and request states live in [`admin-kit.tsx`](../../apps/web/src/features/admin/admin-kit.tsx).

The UI sends complete validated models, displays server errors and refetches after a successful upsert. It may hide administration from non-admin roles, but API `configuration:write` and scope checks are the security boundary.

## Failures, tests and interview answer

Test invalid keys, disabled references, cross-scope updates, impossible queue links, DTO bounds, audit/outbox rollback and active-versus-admin list behavior. Also test that Ticket/Intake reject stale configuration rather than trusting an earlier frontend list.

> I treated configuration as domain data, not environment variables. Nest services validate permission and regional scope, then upsert the row, audit the bounded previous state and enqueue a configuration event in one transaction. Ticket creation revalidates queue/category selection at use time, so an option becoming disabled after the UI loaded cannot bypass the rule.
