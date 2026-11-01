# Workflow interview Q&A

[Back to Workflow index](README.md)

---

## 30 seconds
> Lifecycles are database-backed directed graphs per category. Every status change checks the edge, and any role limit on it, in the same transaction as the update; the UI only offers the next statuses the server computed. Saving a workflow runs a reachability check so no status can become a dead end. A single-instance scheduler, guarded by a PostgreSQL try-advisory lock, runs SLA, regulatory and escalation work each minute.

## Questions

**Q1. Why store workflows in the database?**
> Each bank has its own process. Data lets them add a state or restrict a move without a release, while the product still enforces invariants (no dead ends, role limits, audit on every change).

**Q2. What happens if the UI offers a move that's no longer allowed?**
> The server re-checks with `assertTransition` inside the transaction and returns 409. The UI's list is a convenience computed by the same service.

**Q3. 409 vs 403 for transitions: why the difference?**
> No edge is a state problem (409, "that move doesn't exist"). An edge restricted to roles you don't hold is a permission problem (403).

**Q4. How do you prove a workflow has no dead ends?**
> Build an adjacency map, require `submitted` to have an exit and at least one terminal, then DFS from every mentioned status with a visited set; any status that can't reach `closed` or `cancelled` is rejected with a 409.

**Q5. How do you stop two API instances running the same scheduled job?**
> `pg_try_advisory_xact_lock(804232)` inside the tick's transaction. One instance gets true and runs; the others get false and skip immediately. The lock is released automatically at commit, or if the connection dies.

**Q6. Why `setTimeout` chaining rather than `setInterval` or a cron library?**
> Chaining guarantees no overlap even if a tick is slow, needs no dependency, and stops cleanly through the Nest lifecycle. Cross-instance coordination is the database's job, through the advisory lock.

**Q7. How would you scale this?**
> Run the scheduler in a dedicated worker deployment and keep it off on API pods. The jobs are already batch-bounded and skip-locked, so later you could split them into separate workers or move timers to a workflow engine.

## Honest limitations

1. Automatic moves (auto-assign, escalation, manual assign) set statuses without consulting the category's workflow edges.
2. "Last run" cadence is in memory, so hourly/daily jobs may rerun early after a restart (harmless, but not exact).
3. Workflow saves are last-write-wins, with no version check between two administrators.
4. The seeded workflow only restricts cancellation; approval-before-resolve guards would be extra edges or rules.
