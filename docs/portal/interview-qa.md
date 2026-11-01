# Portal interview Q&A

[Back to Portal index](README.md)

---

## 30 seconds
> The customer portal is a separate security boundary, not a weaker staff API. Customers authenticate against their own realm, issuer and audience, checked by a dedicated guard that exposes only the subject. Every query joins through `PORTAL-<subject>`, so ownership never comes from request input, and missing and foreign IDs both return 404. Creation goes through intake; replies and uploads reuse shared services; responses are friendly projections with no-store caching and per-customer rate limits.

## Questions

**Q1. Why not reuse the staff guard with a "customer" role?**
> Different populations and trust levels. Separate issuers and audiences make cross-use cryptographically impossible: a staff token fails the portal guard and vice versa. The staff role model, with queues and branches, doesn't apply to customers.

**Q2. How does a customer only see their own requests?**
> The guard gives a verified subject; the service maps it to `PORTAL-<subject>` and every SQL query joins `ticket_references` on that value, plus `source_channel='portal'` and not redacted. No customer ID is ever accepted from the request.

**Q3. Why 404 rather than 403 for someone else's request?**
> To avoid confirming that the ID exists (enumeration).

**Q4. What does the customer not see?**
> Internal notes, assignee, queue, SLA, internal status codes, staff attachments, pending/rejected messages and scan verdict details.

**Q5. How is double submission prevented?**
> The form keeps a submission key across retries; the portal turns it into an intake message ID, so the intake ledger returns the same ticket.

**Q6. Why are rate limits in the database?**
> They need to hold across instances and be per customer. The global Fastify rate limit is per IP and per instance.

**Q7. Why `Cache-Control: no-store`?**
> Customer data shouldn't be cached by shared proxies or left in the browser's HTTP cache on a shared computer.

## Limitations
1. No live updates in the portal (refresh on action).
2. If the portal OIDC is missing, the routes 404 (by design), which looks like "not deployed".
3. A subject longer than 200 characters is hashed; collisions are negligible but possible in theory.
