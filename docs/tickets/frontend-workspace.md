# Frontend: the case workspace

`/tickets/:ticketId`: one ticket, full screen, with a summary always visible and the details split into tabs.

[Back to Tickets index](README.md)

---

## 1. Layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to tickets   Subject (h1)   [status][priority][SLA][...]      │
│                                         [Assign] [Change status]     │
├──────────────────────────────────────────────┬───────────────────────┤
│ Description (editable)                       │ Details               │
│ Tabs: Activity | Communications | Attachments│ Service levels        │
│       Related | Compliance | Retention* |    │ Customer references   │
│       Audit trail*                           │ (masked, Reveal*)     │
└──────────────────────────────────────────────┴───────────────────────┘
  * only for capable roles
```

| Component | File | Notes |
|---|---|---|
| Page | [ticket-page.tsx](../../apps/web/src/features/ticket/ticket-page.tsx) | Loads `useTicket(id)`, tabs in `?tab=` |
| Header | [ticket-header.tsx](../../apps/web/src/features/ticket/ticket-header.tsx) | Badges, Assign (supervise), Change status (workTicket) |
| Description | [description-card.tsx](../../apps/web/src/features/ticket/description-card.tsx) | Inline edit with `expectedUpdatedAt` |
| Sidebar | [case-sidebar.tsx](../../apps/web/src/features/ticket/case-sidebar.tsx) | Priority select, SLA dates, masked refs, reveal modal |
| Status modal | [change-status-modal.tsx](../../apps/web/src/features/ticket/change-status-modal.tsx) | [status-change-flow](status-change-flow.md#2-frontend-building-the-command) |
| Assign modal | [assign-modal.tsx](../../apps/web/src/features/ticket/assign-modal.tsx) | [manual assignment](../assignment-and-routing/manual-assignment.md) |

---

## 2. Loading and the 403 = 404 rule

[ticket-page.tsx#L43-L50](../../apps/web/src/features/ticket/ticket-page.tsx#L43-L50):

```ts
if (ticket.isPending) return <LoadingBlock rows={10} height={24} />;
if (ticket.isError) {
  const hidden = ticket.error instanceof ApiError && (ticket.error.status === 403 || ticket.error.status === 404);
  return hidden ? <EmptyState title="This ticket is not available" ... /> : <ErrorBlock ... onRetry={refetch} />;
}
```

**Plain:** "you can't see it" and "it doesn't exist" look identical, so a user can't probe for hidden tickets by trying IDs. Other errors (network, 500) offer Retry.

---

## 3. Tabs

[ticket-page.tsx#L63-L83](../../apps/web/src/features/ticket/ticket-page.tsx#L63-L83):

| Tab | File | What it does | Topic doc |
|---|---|---|---|
| Activity | [activity-tab.tsx](../../apps/web/src/features/ticket/tabs/activity-tab.tsx) | Note composer (internal / reply to customer) + merged timeline of notes and status history | this page |
| Communications | [communications-tab.tsx](../../apps/web/src/features/ticket/tabs/communications-tab.tsx) | Template messages, approve/reject | [Communications](../communications/frontend.md) |
| Attachments | [attachments-tab.tsx](../../apps/web/src/features/ticket/tabs/attachments-tab.tsx) | 3-step upload, scan state, download | [Attachments](../attachments/frontend.md) |
| Related | [related-tab.tsx](../../apps/web/src/features/ticket/tabs/related-tab.tsx) | Link by full UUID, list in/out links | this page |
| Compliance | [compliance-tab.tsx](../../apps/web/src/features/ticket/tabs/compliance-tab.tsx) | Complaint marking, flags, AFCA, communication block | [Compliance](../compliance/frontend.md) |
| Retention | [retention-tab.tsx](../../apps/web/src/features/ticket/tabs/retention-tab.tsx) | Legal hold + keep-until (supervise only) | [Retention](../retention/README.md) |
| Audit trail | [audit-tab.tsx](../../apps/web/src/features/ticket/tabs/audit-tab.tsx) | Hash-linked timeline, export (viewAudit only) | [Audit](../audit/frontend.md) |

- `?tab=attachments` survives refresh and can be shared ([L41](../../apps/web/src/features/ticket/ticket-page.tsx#L41), [L63](../../apps/web/src/features/ticket/ticket-page.tsx#L63)).
- `keepMounted={false}`: an inactive tab's components, and their API calls, don't exist.
- The tab row scrolls sideways on narrow screens instead of wrapping.
- The Compliance tab turns red when a regulatory clock is at risk ([L53](../../apps/web/src/features/ticket/ticket-page.tsx#L53)).

---

## 4. Activity tab in detail

[activity-tab.tsx#L27-L79](../../apps/web/src/features/ticket/tabs/activity-tab.tsx#L27-L79)

- **Two note types:** "Internal note" (staff only) and "Reply to customer" (shown in the portal; counts as the first response).
- If communications are blocked, the reply type shows a red alert and the button is disabled ([L31](../../apps/web/src/features/ticket/tabs/activity-tab.tsx#L31), [L49](../../apps/web/src/features/ticket/tabs/activity-tab.tsx#L49)). The server refuses anyway.
- **Merged timeline** ([L35-L38](../../apps/web/src/features/ticket/tabs/activity-tab.tsx#L35-L38)): notes and status history combined into one list, sorted newest first, including automatic moves (auto-assignment, escalation, customer reply).
- Authors are shown with `PersonName`, which renders machine actors as "Automatic (escalation)".

## 5. Related tab

[related-tab.tsx#L16-L57](../../apps/web/src/features/ticket/tabs/related-tab.tsx#L16-L57): enter a full UUID (pattern-checked) and a relationship type. The list shows the direction ("This ticket is duplicate of" vs "Target of ... from"). Links store IDs only, so opening a linked ticket goes through normal policy.

## 6. Sidebar: masked references and reveal

[case-sidebar.tsx#L73-L105](../../apps/web/src/features/ticket/case-sidebar.tsx#L73-L105):

- References always shown masked (`<Code>••••2345</Code>`).
- **Reveal** button only for `supervise`. The result is held in component state, shown once in a modal with "This reveal has been recorded in the audit trail under your name", and cleared on close. It is **not** put in the React Query cache.
- A step-up 403 shows the banner automatically (shared `api.ts` behaviour).

---

## 7. Capabilities vs resource state

| UI check | Example | Is it security? |
|---|---|---|
| `can('workTicket')` | show composer, upload form, status button | No |
| `can('supervise')` | Assign, Reveal, Retention tab, approve buttons | No |
| `can('viewAudit')` | Audit tab | No |
| `allowedNextStatuses.length === 0` | Disable "Change status" with a tooltip ([ticket-header.tsx#L49-L52](../../apps/web/src/features/ticket/ticket-header.tsx#L49-L52)) | No (server rechecks) |
| `communications_blocked` | disable customer replies | No (server rechecks) |
| `malwareStatus === 'clean'` | show Download | No (server rechecks) |

A supervisor may still get 403 for a ticket in another queue, or a step-up 403. The API decides.

---

## 8. Live updates on this screen

When a colleague changes the ticket, the SSE event triggers `refreshTicket(id)`; the cached detail is replaced and the screen re-renders. If access was lost, the query is reset and the page shows "not available". See [Live updates](../live-updates/frontend.md).

## 9. Interview answer

> The case workspace reads one full server projection and splits it into URL-addressable tabs, with summary, SLA and masked references always visible. Buttons come from role capabilities and server-provided state like `allowedNextStatuses`, but every action goes through the API, which re-checks. All mutations share one hook that refetches and patches caches, so stale 409s and colleagues' SSE changes converge the same way. 403 and 404 render identically, and revealed references are shown once and never cached.

Next: [Testing](testing.md)
