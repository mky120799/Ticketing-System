# Live updates frontend

[Back to Live updates index](README.md)

---

## 1. Why `fetch` instead of `EventSource`

The browser's built-in `EventSource` **cannot send custom headers**. The only way to authenticate it would be a token in the URL (`/stream?token=...`), which leaks into logs, history and referrers. So we read the stream with `fetch` and parse frames ourselves ([api.ts#L185-L190 comment](../../apps/web/src/api.ts#L185-L190)).

## 2. `subscribeToLiveEvents`

[api.ts#L191-L224](../../apps/web/src/api.ts#L191-L224):

```ts
while (!controller.signal.aborted) {
  try {
    const response = await fetch(`${baseUrl}/events/stream`, { headers: { Authorization: `Bearer ${user.access_token}`, Accept: 'text/event-stream' }, signal });
    if (response.status === 401) { void signOut(); return; }
    handlers.onConnection(true); attempt = 0;
    if (connectedBefore) handlers.onResync();               // we reconnected: events may have been missed
    connectedBefore = true;
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let buffer = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      buffer += value; const frames = buffer.split('\n\n'); buffer = frames.pop() ?? ''; frames.forEach(dispatch); }
  } catch { if (controller.signal.aborted) return; }
  handlers.onConnection(false);
  await sleep(Math.min(30_000, 1000 * 2 ** attempt++));    // 1s, 2s, 4s ... 30s
}
return () => controller.abort();                            // unsubscribe
```

| Technique | Plain meaning |
|---|---|
| `TextDecoderStream` + split on `\n\n` | Turn the byte stream into SSE frames; keep a partial frame in `buffer` |
| `dispatch(frame)` | Regex out `event:` and `data:`; `ticket` → `onTicket`, `notification` → `onNotification`, `resync` → `onResync` |
| Exponential backoff | A down server isn't hammered |
| Resync on every reconnect | Client-side mirror of the server's resync |
| `AbortController` | Clean unsubscribe on unmount or user change |
| `event: expired` | The server closes the stream; the loop reconnects (with the renewed token from the hook) |

## 3. `useLiveUpdates`

[use-live-updates.ts#L16-L33](../../apps/web/src/live/use-live-updates.ts#L16-L33):

```ts
useEffect(() => {
  if (!user || !enabled) return;
  return subscribeToLiveEvents(user, {                       // re-subscribes when `user` changes (renewed token)
    onTicket: (event) => void refreshTicket(queryClient, user, event.ticketId),
    onNotification: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
    onResync: () => void queryClient.invalidateQueries(),    // refetch everything on screen
    onConnection: setConnected
  });
}, [user, enabled, queryClient]);
```

- **Events are hints, not data.** We never merge `{status}` into the cache; we refetch through the policy-checked API. If access was lost, `refreshTicket` gets 403/404 and removes the ticket ([ticket-cache.ts#L64-L67](../../apps/web/src/features/tickets/ticket-cache.ts#L64-L67)).
- `enabled = can('readCases')`: administrators don't open a stream ([app-layout.tsx#L37-L39](../../apps/web/src/layout/app-layout.tsx#L37-L39)).
- A renewed token changes `user` → the effect re-runs → the old stream is aborted and a new one opens with the new token.
- Header badge: green "Live" or grey "Offline" with the tooltip "Reconnecting: data may be out of date" ([app-layout.tsx#L56-L60](../../apps/web/src/layout/app-layout.tsx#L56-L60)).

## 4. Interview answer

> Native `EventSource` can't send an Authorization header, so I read the SSE stream with `fetch` and a `TextDecoderStream`, parse frames, reconnect with exponential backoff, and resync on every reconnect. The React hook maps ticket events to a policy-checked refetch of that one ticket, notification events to an inbox refetch, and resync to invalidating everything. It re-subscribes when the token renews. Events never write data into the cache directly.
