# Live updates interview Q&A

[Back to Live updates index](README.md)

---

## 30 seconds
> Domain transactions call `pg_notify` with a tiny payload and the ticket's policy scope; PostgreSQL delivers it only on commit. Each API instance LISTENs once and fans out to its SSE clients after re-running ticket policy per subscriber. Streams are authenticated, capped, heartbeated and closed at token expiry, and a listener reconnect triggers resync. The browser refetches through REST instead of trusting event data.

## Questions

**Q1. Why SSE instead of WebSockets?**
> We only need server → client pushes. SSE is plain HTTP (it works through proxies and auth headers), has simple reconnect semantics and needs no extra protocol or library. WebSockets add complexity we don't need.

**Q2. Why PostgreSQL NOTIFY instead of Redis pub/sub or Kafka?**
> It's transactional: no commit, no message. Every instance already has PostgreSQL, so multiple instances work without new infrastructure. At much higher scale, I'd move fan-out to a broker.

**Q3. How do you stop a user receiving events about tickets they can't see?**
> The NOTIFY message carries the ticket's policy scope; each instance runs the same `assertTicketAccess` per subscriber before sending. The payload is minimised anyway, and the browser refetches through the protected API.

**Q4. What if the listener disconnects?**
> NOTIFY isn't queued, so missed events are gone. On reconnect we broadcast `resync` and clients refetch everything visible. The client also resyncs whenever its own stream reconnects.

**Q5. A stream is authenticated once. What if the token expires or is revoked?**
> The controller schedules a close at the token's `exp`. Revocation is bounded by the token lifetime; for faster cut-off we could re-check introspection periodically on open streams.

**Q6. Why fetch-based SSE on the client?**
> `EventSource` can't set headers, and tokens must not go in URLs.

**Q7. How does a queue move notify the old audience?**
> `notify` includes `previousScope`, and subscribers who could see the ticket in the old queue get the ping and refetch, at which point it disappears from their list.

## Limitations
1. Subscribers are held in memory per instance (fine; each instance serves its own).
2. The 5-stream cap is per instance, not global.
3. Revocation of an open stream waits for token expiry.
4. The portal has no live updates.
