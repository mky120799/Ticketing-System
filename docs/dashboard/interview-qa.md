# Dashboard interview Q&A

[Back to Dashboard index](README.md)

---

## 30 seconds
> The dashboard is a scoped read model: every aggregate runs with the viewer's entity, country and queues as bound parameters, using `COUNT FILTER` for many numbers in one pass and `generate_series` for gap-free weekly trends. Views are audited, the UI renders server numbers with accessible table alternatives, and drilling into tickets is a new authorised request.

## Questions

**Q1. Why is applying the same scope to every number important?**
> Mixing a global total with scoped breakdowns leaks the size of what you can't see. Consistent scope means the numbers reveal nothing beyond your own queues.

**Q2. Why `COUNT(*) FILTER` instead of separate queries?**
> One pass over the rows gives all the counts, which means less I/O and a consistent snapshot.

**Q3. How do you show weeks with zero tickets?**
> Generate the week series first and left-join or subquery counts onto it, so empty weeks are rows with 0.

**Q4. Could a dashboard tile be used to access tickets?**
> No. It's numbers only; clicking through runs the normal ticket list or detail queries with full policy.

**Q5. How would you scale it?**
> A nightly or hourly rollup table keyed by scope and day, refreshed by the scheduler, with the dashboard reading rollups for history and live tables only for "right now".

## Limitations
1. No multi-entity scope test yet.
2. Trends use correlated subqueries (fine at current scale).
3. No caching (each view hits the DB, which keeps it simple and always fresh).
