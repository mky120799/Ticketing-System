# Frontend: administration

The administration surface edits domain configuration while administrators intentionally have no ticket-reading capability.

## Route and sections

[`AdminPage`](../../apps/web/src/features/admin/admin-page.tsx) is lazy-loaded under `/admin/:section`, protected by coarse `administer` capability. Unknown sections redirect to routing. Tabs map one-to-one to URL segments and unmount inactive content:

| Section | Component | Backend resources |
|---|---|---|
| Routing | `routing-section.tsx` | queue members, assignment and escalation rules |
| Intake | `intake-section.tsx` | channel defaults and enablement |
| Service levels | `service-levels-section.tsx` | priority policies |
| Compliance | `compliance-section.tsx` | regulatory profiles, business hours, holidays |
| Workflows | `workflows-section.tsx` | lifecycle graphs/role edges |
| Templates | `templates-section.tsx` | channel templates and approval flag |
| Integration | `integration-section.tsx` | outbox counts/dead letters/replay |

[`admin-kit.tsx`](../../apps/web/src/features/admin/admin-kit.tsx) supplies repeated field/layout/loading/error patterns so sections do not each invent request behavior.

## Query/mutation behavior

Each section loads typed API data under `queryKeys.config(name, args...)`. Forms edit controlled copies rather than mutating query cache objects. Save calls a PUT/upsert endpoint, shows global mutation failure or success feedback, then invalidates/refetches that resource.

The server validates keys, enums, numeric ranges, cross-resource references and administrator legal-entity/country scope. A frontend select listing a queue is not proof that the submitted relationship is valid; server services requery configuration.

## Workflow editor specifics

The UI edits edge rows (`from`, `to`, optional allowed roles). The backend replaces the full graph transactionally and rejects self-edges, no exit from submitted, absent terminal state or any represented non-terminal state unable to reach terminal. The UI should display that conflict without partially updating local “saved” state.

## Integration replay specifics

The screen lists minimized outbox metadata, not event payload. Replay requires deliberate action and moves dead-letter rows to retry—it does not mean Kafka/provider processed them. After replay, summary/events refetch.

## Security and current UX considerations

- Administrators see configuration, not tickets/customer notes.
- API `configuration:write` is final even if route is visible.
- Configuration audit/outbox evidence is produced server-side.
- Sensitive report exports/step-up are separate from generic admin saves.
- Concurrent admins currently rely on last-write/upsert behavior; configuration DTOs generally have no explicit version token. A mature UI/API should expose `updatedAt`/ETag conflict handling for high-risk definitions.

## Interview answer

> Administration is a lazy route split into URL-backed sections, each using typed queries and PUT upserts. The UI edits controlled form copies, then invalidates authoritative data after save. The server revalidates permission, regional scope and cross-resource invariants and commits configuration with audit/outbox. Workflow graphs receive server reachability validation, and outbox replay exposes only minimized metadata. Administrators deliberately cannot open cases.
