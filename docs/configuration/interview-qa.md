# Configuration interview Q&A

[Back to Configuration index](README.md)

---

## 30 seconds
> Configuration is domain data edited by administrators who can't see cases. Every write checks permission, key format, references and jurisdiction, records the previous row in the audit trail, upserts and publishes an event in one transaction. Consumers re-validate configuration at use time, and a short Redis cache for templates is invalidated on save.

## Questions

**Q1. Why not environment variables?**
> These rules change often, are owned by the bank's operations team, must be audited with before/after values and must vary by legal entity. Env vars need a deploy and leave no business audit.

**Q2. How do you stop one entity's admin editing another's setup?**
> Every write checks that referenced queues are in the admin's entity and country, and existing rules or channels owned by another entity are refused.

**Q3. What if a dropdown is stale?**
> Ticket creation calls `assertTicketSelection` to re-check that the category, queue and department are active and compatible right now. The UI list is just a convenience.

**Q4. How are changes evidenced?**
> `AuditService.previous` captures the current row (minus `updated_*`) before the upsert; the audit event stores it as `previous` with the new values, and an outbox `configuration.*_changed` event tells downstream caches.

**Q5. Why can't administrators read tickets?**
> Separation of duties: the people who set routing and deadlines shouldn't also handle customer data.

## Limitations
1. Last-write-wins between concurrent administrators.
2. No UI yet for queues and categories (API only).
3. No staged changes or approvals for configuration (they take effect immediately).
