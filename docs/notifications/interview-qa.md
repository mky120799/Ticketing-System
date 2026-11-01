# Notifications interview Q&A

[Back to Notifications index](README.md)

---

## 30 seconds
> Notification rows are written in the same transaction as their cause, targeting a person or a role-in-queue within an entity and country. The inbox evaluates that audience against the current user's token claims, with read state per person. Creation fires a content-free live hint and the client refetches. Notifications carry only a title and ticket ID, and opening one re-runs the ticket policy.

## Questions

**Q1. Why store notifications instead of just pushing over SSE?**
> SSE is ephemeral: offline users would miss them. Rows give a durable inbox, unread counts and history. SSE is only the "refresh now" accelerator.

**Q2. How do you notify "all supervisors of payments" without a row per person?**
> One row with `recipient_queue='payments'`, `audience_role='supervisor'` and the scope. The audience is matched at read time against each user's queues and roles. Read state is a separate per-user table.

**Q3. Why evaluate the audience at read time?**
> Membership changes. If someone leaves a queue, they stop seeing its notifications immediately, with no fan-out rows to clean up.

**Q4. Can a notification leak data?**
> It holds a title like "A ticket was assigned to you" and a ticket ID. Opening it calls the protected ticket API, which can return 403/404 if access changed.

**Q5. Could someone mark another user's notifications read?**
> No. `markRead` inserts only for notifications matching the caller's own audience, and read rows are keyed by the caller's subject.

**Q6. Why is it created inside the business transaction?**
> So "assigned" and "you were notified" are atomic, and the `pg_notify` push is delivered only on commit.

## Limitations
No cleanup policy, no per-user preferences, no external fan-out.
