# Directory module

Directory converts stable identity-provider subject ids into staff display names and bounded assignee choices. Names improve the UI but never participate in authorization, audit identity or foreign keys.

## Wiring and endpoints

[`DirectoryModule`](../../apps/api/src/directory/directory.module.ts) imports Auth and registers the authenticated profile endpoint plus [`DirectoryController`](../../apps/api/src/directory/directory.controller.ts) and `DirectoryService`.

- `POST /directory/lookup` maps up to 200 subject ids to names. POST keeps a long list of ids out of URLs/access logs.
- `GET /directory/people?queue=` supplies bounded assignee/member-picker options.

Both use `AuthGuard`. Machine identities cannot perform colleague lookups.

## Record and lookup behavior

[`DirectoryService.record`](../../apps/api/src/directory/directory.service.ts) runs when a human staff session is resolved. It upserts `staff_directory` by opaque `subject`, refreshing display name, username, contact metadata, legal entity, country, queues, roles and last-seen time. A failure is logged and ignored because name decoration must never prevent authentication.

`lookup` requires staff read/configuration authority and always filters by the caller's legal entity and country. Unknown/out-of-scope subjects are omitted. `people` additionally requires `ticket:assign` or `configuration:write`, includes only case agents/supervisors, optionally filters by queue, orders by display name and caps the result at 500.

Ticket rows, assignments and audit events store `subject`, not display name. A rename therefore changes future presentation without rewriting evidence, and two people with the same name remain distinct.

## Frontend

[`person-name.tsx`](../../apps/web/src/components/person-name.tsx) batches/resolves opaque ids for rendering. Assignment and queue-membership controls use `/directory/people`, and submitting an assignment sends the selected subject to the Tickets API.

Current gap: the manual Tickets assignment method rechecks the supervisor and target queue but does not yet prove that the submitted assignee is an active member of that queue. A modified browser request can bypass the picker. The required backend fix is an in-transaction `queue_members`/directory validation; the UI picker alone is not sufficient.

Fallback rendering should show a neutral shortened id or “Automatic” for system actors. The client must not cache directory data across authenticated users without including identity scope in the cache key.

## Tests and interview answer

Test same-entity lookup, cross-entity omission, machine identity denial, permission combinations, queue filtering, 200/500 limits, duplicate names and directory-write failure during login.

> I kept authorization identity and human-readable names separate. Tokens and records use the immutable IdP subject. Directory opportunistically refreshes a scoped display record when a person signs in, and the frontend resolves subjects only for presentation. Assignee searches are permission- and region-filtered. I would also call out the current manual-assignment gap: the backend must validate the submitted subject against active queue membership instead of trusting the picker.
