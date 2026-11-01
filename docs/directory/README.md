# Directory: staff names for display

> **Staff directory**: a small table mapping the identity provider's stable **subject IDs** (`dd8a043a-…`) to display names ("Priya Shah"), refreshed from each person's own token when they open the console.
> In plain words: tickets and the audit trail record *who* by an ID that never changes; the directory is the phone book that turns those IDs into names on screen. It is never used to decide access.

## Where it lives

| File | Role |
|---|---|
| [directory/directory.service.ts](../../apps/api/src/directory/directory.service.ts) | `record`, `lookup`, `people` |
| [directory/directory.controller.ts](../../apps/api/src/directory/directory.controller.ts) | `POST /v1/directory/lookup`, `GET /v1/directory/people` |
| [directory/directory.module.ts](../../apps/api/src/directory/directory.module.ts) | Also registers `ProfileController` (`/me`) |
| [auth/profile.controller.ts](../../apps/api/src/auth/profile.controller.ts) | `/me` calls `record` |
| [web/src/components/person-name.tsx](../../apps/web/src/components/person-name.tsx) | Batched name resolution + `PersonName` component |
| [migration 1710000030000](../../apps/api/migrations/1710000030000_staff_directory.cjs) | `staff_directory` |

## Read in this order

1. [How the directory works](how-it-works.md): recording, scoped lookup, people pickers, the batching component.
2. [Interview Q&A](interview-qa.md)

## 30-second answer

> We store immutable IdP subject IDs everywhere (assignee, creator, audit actor), because names change and can collide. When someone calls `/me`, their display name is upserted into a scoped `staff_directory`, on a best-effort basis so a failure never blocks sign-in. Screens resolve IDs through a POST lookup limited to the caller's entity and country, batched in the browser into one call per render and cached. Assignee pickers use a permission- and queue-filtered `people` endpoint. Names are decoration; authorization never reads them.

## Related

[Auth: /me](../auth/profile-and-me.md) · [Manual assignment](../assignment-and-routing/manual-assignment.md) · [Audit frontend](../audit/frontend.md)
