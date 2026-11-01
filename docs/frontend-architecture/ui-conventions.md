# UI conventions

[Back to Frontend architecture index](README.md)

---

## 1. One table for colours and words

[lib/labels.ts](../../apps/web/src/lib/labels.ts) defines how each status, priority, SLA state, regulatory state, sensitivity, scan state and communication state **looks** (colour + label). The queue, the case screen and the dashboard can never disagree ([comment L1-L9](../../apps/web/src/lib/labels.ts#L1-L9)):

| Colour | Meaning |
|---|---|
| gray | not started / neutral |
| blue | being worked on |
| yellow | waiting or at risk |
| red | overdue or urgent |
| green | done / healthy |
| grape | escalated |

Badges always show **text** as well as colour, so colour is never the only signal ([components/badges.tsx](../../apps/web/src/components/badges.tsx#L1-L4)).

## 2. Formatting helpers

[lib/format.ts](../../apps/web/src/lib/format.ts): `humanize('first_response_overdue')` → "First response overdue"; `formatRelative` → "in 3 hours" (the exact time in a tooltip); `formatBytes`; `caseReference(id)` → `CASE-1A2B3C4D` (same rule as the API).

## 3. Loading, error and empty states

[components/states.tsx](../../apps/web/src/components/states.tsx): `LoadingBlock` (skeletons with `role="status"`), `ErrorBlock` (red alert + "Try again"), `EmptyState` (a friendly sentence). Every data region uses one of the three, so pages don't jump or go blank.

## 4. Toasts

[lib/notify.ts](../../apps/web/src/lib/notify.ts): success (4 s), error (8 s, so people have time to read why). The close button has an `aria-label`, found by an axe accessibility check.

## 5. Building blocks

`PageHeader` (the single `<h1>` per page), `SectionCard` (`<h2>` panels), `PersonName` (ID → name with batching), `admin-kit` editors. See [components/](../../apps/web/src/components/).

## 6. Theme and contrast

[theme.ts](../../apps/web/src/theme.ts) / [portal theme.ts](../../apps/portal/src/theme.ts): a `bank` colour palette and **darker text shades** so badges and alerts meet WCAG AA contrast (4.5:1) on white. Light scheme only for now. A bank rebrands by changing the palette.

## 7. Accessibility habits used throughout

| Habit | Example |
|---|---|
| Real links for navigation (not just clickable rows) | [ticket-table.tsx#L28](../../apps/web/src/features/tickets/ticket-table.tsx#L28) |
| `aria-sort` on sortable headers | [ticket-table.tsx#L81](../../apps/web/src/features/tickets/ticket-table.tsx#L81) |
| `aria-live` for counts and feedback | [tickets-page.tsx#L124](../../apps/web/src/features/tickets/tickets-page.tsx#L124) |
| Native file inputs with labels | [attachments-tab.tsx#L80-L82](../../apps/web/src/features/ticket/tabs/attachments-tab.tsx#L80-L82) |
| Charts with table alternatives | [dashboard-widgets.tsx#L34-L43](../../apps/web/src/features/dashboard/dashboard-widgets.tsx#L34-L43) |
| Focus moves to new content | [portal app.tsx#L64-L67](../../apps/portal/src/app.tsx#L64-L67) |
| Accessible names on icon buttons | [notification-menu.tsx#L42](../../apps/web/src/layout/notification-menu.tsx#L42) |

Playwright tests run **axe** checks ([e2e/README.md](../../e2e/README.md)).

## 8. Security habits in the UI

- Text from the server is rendered as text (React escapes it); there is no `dangerouslySetInnerHTML`.
- Revealed references are shown once and never cached.
- Download links open with `noopener`.
- The upload-link token is read from the fragment and sent only in a header.
- Nothing security-related lives in CSS or hidden elements.
