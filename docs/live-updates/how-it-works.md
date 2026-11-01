# How live updates work

[Back to Live updates index](README.md) · Code: [live-events.service.ts](../../apps/api/src/live/live-events.service.ts)

---

## 1. Producer side: `notify`

[L43-L48](../../apps/api/src/live/live-events.service.ts#L43-L48):

```ts
async notify(client: PoolClient, type: LiveEventType, ticket: LiveTicket, previousQueue?: string) {
  const message = { payload: { type, ticketId: ticket.id, status: ticket.status, at: new Date().toISOString() },
                    scope: this.scopeOf(ticket) };                         // queue, branch, dept, entity, country, sensitivity, created_by, assigned_to
  if (previousQueue && previousQueue !== ticket.queue) message.previousScope = { ...message.scope, queue: previousQueue };
  await client.query('SELECT pg_notify($1, $2)', ['ticket_live', JSON.stringify(message)]);
}
```

| Detail | Plain reason |
|---|---|
| Takes the transaction `client` | NOTIFY is part of the transaction: no commit, no ping |
| `payload` vs `scope` | `payload` goes to browsers; `scope` is used **server-side only** to decide who may receive it |
| `previousScope` | When a ticket moves queues, people watching the **old** queue get a ping too, so their list drops it |
| Event types | `ticket.created/updated/assigned/status_changed/note_added/escalated/sla_changed` ([L7](../../apps/api/src/live/live-events.service.ts#L7)) |

`notifyPerson` ([L51-L54](../../apps/api/src/live/live-events.service.ts#L51-L54)) sends `{ kind: 'person', user | queue+role, entity, country }` for notification-inbox hints.

PostgreSQL limits NOTIFY payloads to about 8 KB; our messages are a few hundred bytes.

## 2. Listener side: one connection per instance

[connect, L81-L97](../../apps/api/src/live/live-events.service.ts#L81-L97):

```ts
const client = new Client({ connectionString: process.env.DATABASE_URL });   // dedicated, NOT from the pool
client.on('notification', (m) => { if (m.channel === 'ticket_live' && m.payload) this.dispatch(m.payload); });
client.on('error', lost); client.on('end', lost);
await client.connect(); await client.query('LISTEN ticket_live');
if (this.hasConnectedBefore) this.broadcast({ event: 'resync', data: {} });   // we were offline: tell everyone to refetch
```

- A **dedicated** `pg.Client`, because a LISTEN connection must stay open and can't be returned to a pool.
- Reconnect with exponential backoff, 1 s up to 30 s ([scheduleReconnect, L99-L105](../../apps/api/src/live/live-events.service.ts#L99-L105)).
- **Resync on reconnect:** NOTIFY messages sent while we were disconnected are gone (they aren't queued), so clients must refetch.
- Shutdown guard: if the app stops while connecting, the orphan connection is closed ([L90](../../apps/api/src/live/live-events.service.ts#L90)).

**Why no Redis or Kafka for this?** Every instance already talks to PostgreSQL; each listens and serves its own subscribers. Horizontal scaling needs no extra infrastructure at this scale.

## 3. Fan-out with policy

[dispatch, L107-L122](../../apps/api/src/live/live-events.service.ts#L107-L122):

```ts
for (const subscriber of this.subscribers) {
  if (this.canSee(subscriber.user, message.scope) || (message.previousScope && this.canSee(subscriber.user, message.previousScope)))
    this.safeSend(subscriber, { event: 'ticket', data: message.payload });
}
// canSee = try { policy.assertTicketAccess(user, scope, 'ticket:read'); return true } catch { return false }
```

The **same `assertTicketAccess`** as the REST API ([policy.service.ts#L22-L32](../../apps/api/src/auth/policy.service.ts#L22-L32)), so a restricted ticket's ping only reaches supervisors and auditors in its queue. A failed send removes the subscriber (`safeSend`, [L129](../../apps/api/src/live/live-events.service.ts#L129)). Malformed JSON is ignored.

## 4. The SSE endpoint

[live-events.controller.ts#L17-L35](../../apps/api/src/live/live-events.controller.ts#L17-L35):

```ts
@Get('stream') stream(@Req() request, @Res() reply) {
  this.policy.assertPermission(user, 'ticket:read');
  const unsubscribe = this.live.subscribe(user, write);    // 429 if 5 streams already (before taking over the response)
  reply.hijack();                                           // we write the raw Node response ourselves
  raw.writeHead(200, { ...reply.getHeaders(),               // keep CORS headers Fastify already set
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });  // tell nginx not to buffer
  raw.write('retry: 5000\n\n: connected\n\n');
  const heartbeat = setInterval(() => raw.write(': ping\n\n'), 25_000);
  const expiry = setTimeout(() => { raw.write('event: expired\ndata: {}\n\n'); raw.end(); }, msUntilTokenExpiry);
  raw.on('close', () => { clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); });
}
```

| Line(s) | Detail | Why |
|---|---|---|
| `AuthGuard` + `ticket:read` | Administrators (no case access) get no stream | Same policy as REST |
| [L24](../../apps/api/src/live/live-events.controller.ts#L24) | `subscribe` before `hijack` | The 429 "too many streams" can still go through Nest's normal error path |
| [L26-L27](../../apps/api/src/live/live-events.controller.ts#L26-L27) | `hijack` + copy headers | Streaming bypasses Fastify's send; CORS headers would otherwise be lost |
| [L28](../../apps/api/src/live/live-events.controller.ts#L28) | `retry: 5000` | EventSource-style clients reconnect after 5 s |
| [L30](../../apps/api/src/live/live-events.controller.ts#L30) | `: ping` comment every 25 s | Keeps proxies and load balancers from timing out the idle connection |
| [L32-L33](../../apps/api/src/live/live-events.controller.ts#L32-L33) | Close at token `exp` | **A stream must not outlive the token that authorised it.** The guard only ran once, at connect |
| [L34](../../apps/api/src/live/live-events.controller.ts#L34) | Cleanup on close | No leaked timers or subscribers |
| `MAX_STREAMS_PER_USER = 5` ([service L20](../../apps/api/src/live/live-events.service.ts#L20)) | Abuse limit | One leaked token can't open hundreds of streams |

Wire format (each frame ends with a blank line):

```text
id: 7
event: ticket
data: {"type":"ticket.status_changed","ticketId":"4f1c…","status":"resolved","at":"2026-10-25T10:00:00Z"}

```

The global rate limiter excludes `/v1/events/stream` ([main.ts#L18](../../apps/api/src/main.ts#L18)): one long request shouldn't count against the per-minute budget.

## 5. Metric

`live_event_streams`: connected streams on this instance ([metrics.service.ts#L22-L23](../../apps/api/src/metrics/metrics.service.ts#L22-L23)).

## 6. Test

[workflow.integration-spec.ts#L73](../../apps/api/test/workflow.integration-spec.ts#L73) ("serves a real SSE stream"), and the "pushes only authorized live events" part of [L31](../../apps/api/test/workflow.integration-spec.ts#L31).

Next: [Frontend](frontend.md)
