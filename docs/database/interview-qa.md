# Database interview Q&A

[Back to Database index](README.md)

---

**Q1. How do you make a business change and its audit atomic?**
> One `PgService.transaction` gives one `PoolClient`; the update, the audit insert, the outbox insert and `pg_notify` all use it. Any throw rolls everything back.

**Q2. Why these pool timeouts?**
> A connection timeout so saturation fails fast; a statement timeout so runaway queries die; an idle-in-transaction timeout so a stuck request can't hold the audit advisory lock and freeze every audited write.

**Q3. What isolation level, and why is that OK?**
> READ COMMITTED (the default). It's fast; where read-check-write matters I add explicit row locks, conditional updates or advisory locks.

**Q4. When do you use SKIP LOCKED vs FOR UPDATE?**
> `FOR UPDATE` when I must act on *this* row and others should wait. `SKIP LOCKED` when any available row will do (queues), so workers never block each other.

**Q5. What's an advisory lock and where do you use it?**
> A named application lock with no row behind it. I use it to serialise the audit chain head, per-queue assignment and per-message intake, and a try variant elects one scheduler instance.

**Q6. How do you prevent SQL injection?**
> Parameters for every value; the few dynamic fragments are fixed strings in code, each commented.

**Q7. How do you stop the app rewriting the audit trail?**
> Migrations run as the owner; the app's role has UPDATE, DELETE and TRUNCATE revoked on audit tables, and a startup check refuses to run if the app could tamper.

**Q8. What concurrency bug would you fix first?**
> Lost updates on ticket edits: make the update conditional on the expected `updated_at` (or a version) and return 409 on zero rows, with a two-connection test.

**Q9. How do you keep transactions short?**
> No network calls inside them: presign after commit, publish between claim and mark, and send email after the lease commit.
