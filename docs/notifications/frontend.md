# Frontend: the bell

[Back to Notifications index](README.md) · Previous: [Live push](live-push.md) · Next: [Performance and limits](performance-and-limits.md) · Code: [notification-menu.tsx](../../apps/web/src/layout/notification-menu.tsx)

The bell is one React component in the console's header. It shows an unread badge, opens a dropdown of the newest notifications, marks them read, and navigates to tickets. It is small, but it shows several patterns used across the frontend: server state in TanStack Query, invalidation instead of polling, and never trusting a notification as permission.

---

## 1. Where it appears, and for whom

[app-layout.tsx#L37-L39](../../apps/web/src/layout/app-layout.tsx#L37-L39) and [L61](../../apps/web/src/layout/app-layout.tsx#L61):

```tsx
// Administrators have no case access, so they get neither the live feed nor notifications.
const caseWorker = can('readCases');
const live = useLiveUpdates(user, caseWorker);
...
{caseWorker && <NotificationMenu />}
```

The bell and the live stream are shown only to people who can read cases. This mirrors the server, where both `GET /v1/notifications` and `GET /v1/events/stream` require `ticket:read`. Hiding the bell is a convenience; the server check is the real control.

---

## 2. The data: one query, one mutation

[notification-menu.tsx#L17-L30](../../apps/web/src/layout/notification-menu.tsx#L17-L30):

```tsx
const { data } = useQuery({ queryKey: queryKeys.notifications, queryFn: () => getNotifications(user) });
const unread = data?.unread ?? 0;

const markRead = useMutation({
  mutationFn: (ids?: string[]) => markNotificationsRead(user, ids),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
});
```

**The query.** `queryKeys.notifications` is `['notifications']` ([query-keys.ts#L17](../../apps/web/src/lib/query-keys.ts#L17)). `getNotifications` calls `GET /notifications` and returns `{ notifications: StaffNotification[], unread: number }` ([api.ts#L230-L231](../../apps/web/src/api.ts#L230-L231)).

**When it refreshes.** The app's query defaults are `staleTime: 30_000` and `refetchOnWindowFocus: false` ([query-client.ts#L16-L24](../../apps/web/src/lib/query-client.ts#L16-L24)), and the bell sets no `refetchInterval`. So the inbox is fetched:

| Trigger | Mechanism |
|---|---|
| The header first renders | `useQuery` on mount |
| A live `notification` event arrives | `useLiveUpdates` invalidates `['notifications']` ([use-live-updates.ts#L25](../../apps/web/src/live/use-live-updates.ts#L25)) |
| The live stream reconnects (`resync`) | everything is invalidated ([L27](../../apps/web/src/live/use-live-updates.ts#L27)) |
| This user marks something read | the mutation's `onSuccess` invalidates |

There is **no polling**. If the stream is down (the header shows "Offline"), the badge does not change until the stream reconnects, at which point `resync` catches up. That is a deliberate trade: zero background requests in the normal case, a visible "Offline" indicator in the abnormal one.

**The mutation.** `markNotificationsRead(user, ids?)` posts `{ ids }`, or `{}` for "mark all" ([api.ts#L232-L233](../../apps/web/src/api.ts#L232-L233)). After success it invalidates the query rather than editing the cache by hand, so the badge always shows the **server's** count. (Updating the cache optimistically would feel faster but could show a count the server disagrees with.)

---

## 3. Opening a notification

[L32-L36](../../apps/web/src/layout/notification-menu.tsx#L32-L36):

```tsx
const open = (ticketId: string | null, id: string) => {
  close();
  markRead.mutate([id]);
  if (ticketId) navigate(`/tickets/${ticketId}`);
};
```

Close the dropdown, mark this one read (fire and forget), and go to the ticket page. The ticket page loads the ticket with `GET /v1/tickets/:id`, which runs the full ticket policy and writes a `ticket.viewed` audit event. The comment at the top of the file states the rule ([L1-L5](../../apps/web/src/layout/notification-menu.tsx#L1-L5)): *a notification can never show more than the person may see.* If access changed since the notification was written (the ticket moved to a queue they do not hold), the ticket page shows "not available".

---

## 4. The UI pieces

[L38-L67](../../apps/web/src/layout/notification-menu.tsx#L38-L67), built from Mantine components:

| Element | Detail |
|---|---|
| `Popover` + `Popover.Target` + `ActionIcon` | The bell button. The comment notes the button must be the Target's **direct child**, because Mantine puts `aria-haspopup` and `aria-expanded` on that element ([L40](../../apps/web/src/layout/notification-menu.tsx#L40)) |
| `aria-label={`Notifications, ${unread} unread`}` | Screen readers hear the count, not just "button" |
| `Indicator label={unread > 99 ? '99+' : unread} disabled={unread === 0}` | The red badge, capped at "99+", hidden at zero |
| Header row with "Mark all read" | Disabled when there is nothing unread; calls `markRead.mutate(undefined)`, which the API treats as "all" |
| `ScrollArea.Autosize mah={380}` | The list scrolls within the dropdown instead of growing off screen |
| `UnstyledButton` per item with `data-unread` | Each notification is a real button (keyboard focusable). Unread items are bold and tinted through the `data-unread` attribute ([styles.css#L51-L62](../../apps/web/src/styles.css#L51-L62)) |
| `formatRelative(n.createdAt)` | "5 minutes ago", using `Intl.RelativeTimeFormat` ([format.ts#L28-L33](../../apps/web/src/lib/format.ts#L28-L33)) |
| `EmptyState title="You are all caught up"` | Shown when the list is empty |

---

## 5. What the bell does not do (yet)

| Gap | Effect | Possible change |
|---|---|---|
| Shows only the newest 50 | Older notifications are unreachable from the UI, though still counted in the badge | A "show more" using keyset paging on `(created_at, id)` |
| No error state | If `GET /notifications` fails, the badge just shows 0 | Show a small error indicator from `useQuery`'s `isError` |
| Title only, no ticket reference | Several "A ticket was assigned to you" items look identical | Include the ticket's short reference in the API response |
| No browser test | The flow is covered by the API integration test, not by Playwright | A Playwright test: assign in one browser context, see the badge in another |
| No per-type filtering or muting | Everything appears in one list | Preferences (see [performance and limits](performance-and-limits.md#5-what-to-build-next)) |

Next: [Performance and limits](performance-and-limits.md)
