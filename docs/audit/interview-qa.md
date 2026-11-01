# Audit interview Q&A

[Back to Audit index](README.md) · General technique: [answer playbook](../interview-prep/answer-playbook.md)

---

## 1. The three answer levels

### 30 seconds
> Every material action writes an audit event inside the same PostgreSQL transaction as the business change, so they commit or roll back together. Events form a SHA-256 hash chain over canonical JSON, including the timestamp and previous hash, serialised by an advisory lock. The database is append-only through triggers, and the app runs as a role without update, delete or truncate. A scheduler verifies the chain and publishes signed anchors outside the database, which catch deletion of the newest events. Auditors search within their scope, and reading the trail is itself audited.

### 2 minutes
> **Write path.** A service opens `PgService.transaction`, updates the ticket, then calls `AuditService.write(client, ...)` with the same client. The writer takes `pg_advisory_xact_lock(804231)`, reads the latest `event_hash`, adds request context from `AsyncLocalStorage` (IP, user agent, token ID, ACR), normalises metadata exactly as PostgreSQL will store it, and computes a version-2 hash over stable-stringified JSON. It inserts the event and can also enqueue a SIEM copy through the outbox, still in the same transaction.
>
> **Protection.** Two triggers reject UPDATE, DELETE and TRUNCATE. `roles.sql` gives the runtime account only INSERT and SELECT on audit tables, and the app checks its own privileges at startup and refuses to run in production if it could tamper.
>
> **Detection.** `AuditIntegrityService.verify` walks events in 5,000-row batches, checks each link, recomputes v2 hashes and compares published anchors. Anchoring runs a full verify, signs `(sequence, head, time)` with Ed25519, writes it to object storage and the outbox. A missing tail shows up as an anchor mismatch.
>
> **Reading.** The audit API needs `audit:read`. Cross-ticket search joins events to tickets and filters by entity, country and queues in SQL. Export needs step-up, and every search, view and export writes its own event.

### Code-level (point at these)
```text
apps/api/src/audit/audit.service.ts             write() L14-30, previous() L36-41
apps/api/src/audit/audit-hash.ts                stableStringify, computeEventHashV2
apps/api/src/audit/audit-integrity.service.ts   verify L33-60, anchor L81-95, checkAnchors L97-111
apps/api/src/audit/anchor-signer.ts             Ed25519 sign/verify, versioned message
apps/api/src/audit/denied-authorization.interceptor.ts   403 → separate transaction
apps/api/src/audit/audit.controller.ts          scoped search SQL L39-47, report L63-72
apps/api/migrations/1710000010000_audit_immutability.cjs, ..23000_audit_truncate_guard.cjs
infra/postgres/roles.sql                        REVOKE UPDATE, DELETE, TRUNCATE
```

---

## 2. Likely questions and model answers

**Q1. How do you guarantee there is never a business change without an audit event?**
> The audit writer takes the transaction's `PoolClient`, not the pool. The business update, audit insert and outbox insert run on one connection inside BEGIN/COMMIT. If the audit insert fails, the whole transaction rolls back.

**Q2. Why a hash chain? Isn't an append-only table enough?**
> Append-only stops the app and accidents, but an owner or superuser can disable triggers. The chain makes any edit or deletion *detectable* by recomputation, independent of who did it.

**Q3. Why canonical JSON?**
> JSON key order isn't guaranteed. If I hashed `JSON.stringify` output, re-serialising the stored row might produce different bytes and a false tamper alarm. `stableStringify` sorts keys recursively and drops undefined values, so the same data always gives the same hash.

**Q4. Why normalise metadata with `JSON.parse(JSON.stringify(...))` before hashing?**
> So that what I hash is exactly what JSONB will give back to the verifier, with undefined dropped and dates as strings. Otherwise writer and verifier would hash slightly different values.

**Q5. What's the advisory lock for?**
> Two concurrent transactions could both read H3 as the latest hash and both append, forking the chain. The transaction-scoped advisory lock makes "read head, append" a critical section. A test fires 48 concurrent audited requests and verifies one valid chain.

**Q6. Doesn't that lock limit throughput?**
> Yes, audited writes serialise for the few milliseconds between lock and commit. That's the cost of a single linear chain. If it became a bottleneck I'd shard chains (per legal entity, or per time bucket with periodic cross-chain anchors), or move to a Merkle-tree batch design. At bank case volumes it's acceptable.

**Q7. If someone deletes the last ten events, does verification catch it?**
> Linkage alone doesn't: the shorter chain is still consistent. The anchor does. Daily, after a full clean verify, we publish `(sequence, head_hash)`, signed, to object storage and the outbox. Verification compares every anchor to the live row; a missing event is `IS DISTINCT FROM` the anchor, so it fails. The integration test proves exactly this.

**Q8. Why sign anchors?**
> So an anchor copy is attributable to the platform's key. An attacker who can write to the anchor store still can't forge a valid signature. Once signing starts, every later anchor must be signed, so an attacker can't strip a signature off a forged one.

**Q9. Why are 403s audited in a separate transaction?**
> The business transaction rolled back because of the 403, so there's nothing to join. The global interceptor writes `authorization.denied` in a new transaction and rethrows the original error, even if the audit write fails.

**Q10. What do you put in metadata?**
> Facts, not content: status transitions, counts, classifications, lengths and SHA-256 fingerprints of edited text, the names of changed fields. Never note bodies, references or tokens. The audit trail is immutable, so anything personal there could never be deleted, which would conflict with retention law.

**Q11. How do you handle audit tables growing forever?**
> An owner-only archive script re-verifies a range, streams it to JSON-lines with a SHA-256 manifest, records a chain base, deletes with triggers disabled only inside that transaction, and commits. Verification then starts from the base. Archives go to write-once storage.

**Q12. How do auditors search without seeing other entities' data?**
> The search SQL joins each event to its ticket and requires the auditor's entity, country and queues, the same rule as ticket access, with escaped prefix matching and keyset pagination. Every search writes `audit.searched`.

**Q13. Does the hash chain prove the event was true?**
> No. It proves the record hasn't changed since it was written. Truthfulness comes from authentication, authorization and writing in the same transaction as the real change.

**Q14. What's incremental vs full verification?**
> Incremental resumes after the last valid checkpoint; it's cheap and runs hourly, but can't see edits to already-verified events. Full re-walks everything and runs daily before each anchor.

**Q15. What if the app is running as the table owner by mistake?**
> `DatabaseGuardService` checks `has_table_privilege` and ownership at startup. In production `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` makes that fatal, and the production-safety check requires the flag. It's also a metric: `audit_runtime_role_safe`.

---

## 3. Follow-up traps

| Trap | Strong answer |
|---|---|
| "So it's a blockchain?" | "Same linking idea, no distributed consensus. Trust comes from DB least privilege plus external anchors, not mining." |
| "Can't a superuser just recompute all hashes after editing?" | "Yes, inside the DB. That's why anchors live outside it, signed with a key the DB admin doesn't hold." |
| "Why not just ship everything to the SIEM?" | "We can (`AUDIT_STREAM_ENABLED`). But the in-DB chain gives atomicity with the business change, which a separate log pipeline can't." |
| "Why does verification write to the DB it's verifying?" | "It writes to `audit_verifications`, which is also insert-only for the app; the result is also a metric and a log line." |

---

## 4. Honest limitations

1. **Single global chain lock** caps audited write throughput. Fix: per-entity chains or Merkle batches.
2. **Integrity is only as strong as the anchor store's independence.** If one person controls DB, storage and keys, assurance collapses. Fix: separate credentials, Object Lock, keys in a KMS/HSM.
3. **v1 legacy events are link-checked only.** They're reported as `legacyEvents`.
4. **Truncation after the last anchor isn't detectable until the next anchor.** Anchors are daily. Fix: anchor more often, or stream to the SIEM.
5. **Non-ticket events aren't in the auditor search UI.** Configuration and `audit.*` events are available in the DB and SIEM, but not in the scoped search.

---

## 5. If you blank

> "The key invariant is that the audit insert uses the same transaction client as the business change, and each event hashes its own canonical content plus the previous hash. Prevention is triggers plus a restricted role; detection is recompute plus external anchors. I'd open `audit.service.ts` and `audit-integrity.service.ts` to show the exact lines."
