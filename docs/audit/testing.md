# Testing audit

Audit is evidence, so the tests **attack** it: they tamper with rows, delete events, forge signatures and race many writers, then expect verification to catch every case.

[Back to Audit index](README.md)

---

## 1. Test map

| Claim | Test | Level |
|---|---|---|
| A changed timestamp is detected (v2 hashes the time) | [workflow.integration-spec.ts#L196](../../apps/api/test/workflow.integration-spec.ts#L196) step 1 | Real PostgreSQL |
| A deleted middle event breaks the chain | same test, step 2 | Real PostgreSQL |
| Deleting the **newest** events is caught only by the anchor | same test, step 3 (`failureReason` contains "anchor") | Real PostgreSQL |
| Search is scoped, prefix-filtered, and audited; supervisors get 403 | same test, step 4 | Real PostgreSQL |
| List views are audited (`ticket.list_viewed`) | same test, first lines | Real PostgreSQL |
| Edit audit stores before/after facts without free text | [workflow.integration-spec.ts#L247](../../apps/api/test/workflow.integration-spec.ts#L247) | Real PostgreSQL |
| Config audit stores the previous row | same test | Real PostgreSQL |
| Signed anchors verify; a forged signature is caught | same test (`signature='AAAA'`) | Real PostgreSQL + Ed25519 |
| Archive: checksum matches, triggers re-enabled, chain still valid, refuses to archive everything, tampering after archive still caught | same test | Real PostgreSQL + filesystem |
| **Concurrency:** many concurrent writers keep one valid chain | [workflow.integration-spec.ts#L329](../../apps/api/test/workflow.integration-spec.ts#L329) | 48 parallel requests → `verify(true)` valid, >100 events |
| App role can't UPDATE/DELETE/TRUNCATE/DISABLE TRIGGER/DROP | [roles.integration-spec.ts#L25](../../apps/api/test/roles.integration-spec.ts#L25) | Real PostgreSQL, separate roles |
| Truncate guard holds even for the owner | [roles.integration-spec.ts#L58](../../apps/api/test/roles.integration-spec.ts#L58) | Real PostgreSQL |
| Privilege self-check is accurate | [roles.integration-spec.ts#L41](../../apps/api/test/roles.integration-spec.ts#L41) | Real PostgreSQL |
| Production refuses an unrestricted DB role | [production-safety.spec.ts](../../apps/api/test/production-safety.spec.ts) | Unit |
| Auditor sees integrity + search in the real UI | [e2e/tests/staff.spec.ts#L105](../../e2e/tests/staff.spec.ts#L105) | Playwright |

---

## 2. How the tamper test works

The test needs to bypass the append-only trigger to simulate an attacker. It uses a helper ([workflow.integration-spec.ts L202](../../apps/api/test/workflow.integration-spec.ts#L202)):

```ts
const tamper = async (sql, args = []) => {
  await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
  try { return await pool.query(sql, args); }
  finally { await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only'); }
};
```

(The test database connection is the owner, which is exactly the "insider with owner rights" scenario.)

Then, as a story:

```text
verify(true)                       → valid
UPDATE occurred_at += 1 minute     → verify(true) → invalid at that sequence   (v2 hashes timestamps)
restore the timestamp              → valid
DELETE a middle event              → invalid                                    (link broken)
re-insert it                       → valid
anchor()                           → anchored
DELETE all events >= anchor seq    → verify() → invalid, reason mentions anchor (linkage alone looks fine!)
re-insert                          → valid
```

Every attack is **undone** after it is detected, and the chain verifies again. That proves the detector is precise, not just noisy.

---

## 3. The concurrency test

[workflow.integration-spec.ts#L329-L341](../../apps/api/test/workflow.integration-spec.ts#L329-L341) creates 12 tickets in parallel, then fires 48 concurrent requests (note, view, list, patch), all of which write audit events. A full verification must still be valid.

**What it proves:** the advisory lock `804231` really serialises chain-head selection. Without it, two writers would read the same `previous_hash`, the chain would fork, and verification would fail.

---

## 4. How to run

```bash
npm run test:integration --workspace=@bank-case/api     # migrated, otherwise empty DB
ROLES_TEST=1 npm run test:integration --workspace=@bank-case/api   # needs a superuser DATABASE_URL
```

## 5. Gaps worth adding

| Gap | Suggested test |
|---|---|
| Rollback coupling | Inject a failure after `audit.write` inside a ticket transaction; assert neither the ticket change nor the audit row exists |
| Denied-access audit | Call a forbidden route and assert `authorization.denied` with `outcome='denied'` |
| Audit write failure keeps the 403 | Make the interceptor's write fail; assert the response is still 403 |
| Incremental verification blind spot | Tamper with an already-verified event; incremental stays valid, full is invalid |
| Unsigned anchor after a signed one | Insert an unsigned anchor later; expect invalid |
| Frontend | Filters change the query key; one verification at a time; invalid chain shows a red alert |

## 6. Interview answer

> I test audit adversarially against a real PostgreSQL database. The integration test disables the trigger the way an insider could, then changes a timestamp, deletes a middle event and deletes the tail. Verification catches each one, and the tail deletion is caught only by the anchor, which proves why anchors exist. It also forges an anchor signature, archives old events and checks the chain still verifies. A concurrency test fires 48 parallel audited requests and expects one valid chain, which proves the advisory lock. A roles test proves the runtime account can't update, delete, truncate or disable triggers.

Next: [Interview Q&A](interview-qa.md)
