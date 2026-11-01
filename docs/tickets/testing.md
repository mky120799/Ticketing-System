# Testing tickets

[Back to Tickets index](README.md)

---

## 1. Test map

| Claim | Test | Level |
|---|---|---|
| Create is idempotent (same key → same ticket) | [ticket.integration-spec.ts#L43](../../apps/api/test/ticket.integration-spec.ts#L43) | Real PostgreSQL via Nest `inject` |
| Masking preserved (`maskedValue` ends in the last 4) | same test | Integration |
| Create writes an outbox event; dispatch publishes it; receipts are idempotent and conflicting receipts 409 | same test | Integration |
| Notes, communications, delivery receipts (sent → delivered, stale backwards rejected) | same test | Integration |
| Attachment: filename cleaned, download blocked until scan, only scanner may scan, clean → download URL | same test | Integration |
| Search finds by subject; agents can't place legal holds; supervisors can | same test | Integration |
| SLA reconcile: agent 403, supervisor updates once, second run updates 0 | same test | Integration |
| Link, transition, detail projection, dashboard 403 for agent, reveal 403 for agent, audit report/export for auditor, audit row can't be updated | same test | Integration |
| Maker-checker: self-approval 403, independent supervisor ok; failing publisher → dead letter after 5 | [ticket.integration-spec.ts#L103](../../apps/api/test/ticket.integration-spec.ts#L103) | Integration |
| Configuration writes are admin-only and scoped; events emitted | [ticket.integration-spec.ts#L114](../../apps/api/test/ticket.integration-spec.ts#L114) | Integration |
| Stale edit → 409 `stale_ticket`; paging has no overlap; bad cursor 400 | [workflow.integration-spec.ts#L292](../../apps/api/test/workflow.integration-spec.ts#L292) | Integration |
| Resolve needs a root cause; first response recorded | [workflow.integration-spec.ts#L88](../../apps/api/test/workflow.integration-spec.ts#L88) | Integration |
| Data-driven workflow enforced; unusable definitions rejected | [workflow.integration-spec.ts#L139](../../apps/api/test/workflow.integration-spec.ts#L139) | Integration |
| Policy scope rules | [security.policy.spec.ts](../../apps/api/test/security.policy.spec.ts) | Unit |
| A supervisor works a ticket through its life in the real UI | [e2e/tests/staff.spec.ts#L19](../../e2e/tests/staff.spec.ts#L19) | Playwright |

The big ticket integration test is effectively a **scenario test**: one ticket's whole life, asserting the database state (outbox rows, audit counts, statuses) at each step, not just HTTP codes.

## 2. How tests authenticate

Integration tests sign their own JWTs for any role with a test key served as JWKS (`token(role)` helper at the end of `ticket.integration-spec.ts`), so the real `AuthGuard` runs. No `request.user` is faked.

## 3. Gaps worth adding

| Gap | Test idea |
|---|---|
| **Lost update** | Two DB clients: both read `updated_at`, both PATCH with it; today both succeed (red), after the conditional-update fix exactly one wins |
| Concurrent first use of an idempotency key | `Promise.all` two creates with the same key; expect one ticket and both responses returning it |
| Malformed `:ticketId` | Expect 400 (needs `ParseUUIDPipe`) |
| Manual assign to a non-member | Expect 409/403 (after the fix) |
| Rollback coupling | Force the outbox insert to fail; assert no ticket row and no audit row |
| Frontend | `useTicketMutation` refetches on 409; `patchTicketInLists` adds and removes correctly; 403/404 render the same |

## 4. Interview answer

> The ticket suite is a scenario test against a real database: create twice with one idempotency key and expect one ticket, then note, communicate, attach, scan, download, link, transition and reveal, asserting outbox rows, audit counts and permission failures at each step. Separate tests cover stale edits, keyset paging without overlap, maker-checker and dead-lettering. The gap I'd add first is a two-connection lost-update test, which should fail today and pass after the conditional update.
