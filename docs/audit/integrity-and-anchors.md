# Integrity, verification, anchors and archiving

Writing a hash chain is half the job. This page covers how we **prove** it is intact, how we catch someone deleting the newest events, how anchors are signed, and how old events are archived without breaking verification.

[Back to Audit index](README.md) · Terms: [concepts](concepts.md) · Code: [audit-integrity.service.ts](../../apps/api/src/audit/audit-integrity.service.ts)

---

## 1. Layers of protection

| # | Layer | Stops / detects | Code |
|---|---|---|---|
| 1 | Append-only triggers | Accidental or app-level UPDATE/DELETE/TRUNCATE | [migrations](database-protection.md#1-triggers) |
| 2 | Restricted runtime role | The app, or a stolen app credential, rewriting history | [roles.sql](../../infra/postgres/roles.sql#L34-L40) |
| 3 | SHA-256 chain, v2 hashes every field | Any edit or deletion in the middle | [audit-hash.ts](../../apps/api/src/audit/audit-hash.ts) |
| 4 | Scheduled verification | Detects layer-3 breaks, persists the result, raises metrics | `verify()` |
| 5 | External anchors (+ Ed25519) | Deletion of the **newest** events, rewrite by a DB superuser | `anchor()` |
| 6 | Archive with chain base + manifest | Lets old events leave the live table without looking like tampering | [audit-archive.ts](../../apps/api/src/audit/audit-archive.ts) |

---

## 2. The verification algorithm

[audit-integrity.service.ts#L33-L60](../../apps/api/src/audit/audit-integrity.service.ts#L33-L60)

```mermaid
flowchart TD
  S[verify full?] --> C{incremental?}
  C -- yes --> R[resume from last VALID verification<br/>if it is at or after the archive base]
  C -- no --> B[start at archive base or 0]
  R --> LOOP
  B --> LOOP[read next 5,000 events by sequence]
  LOOP --> L1{previous_hash == expected?}
  L1 -- no --> F1[FAIL: chain link broken]
  L1 -- yes --> V2{hash_version >= 2?}
  V2 -- yes --> RH{recomputed hash == event_hash?}
  RH -- no --> F2[FAIL: content does not match hash]
  RH -- yes --> NEXT
  V2 -- no --> LEG[count as legacy, link-checked only] --> NEXT
  NEXT[expected = this event_hash] --> MORE{more rows?}
  MORE -- yes --> LOOP
  MORE -- no --> AN[checkAnchors]
  AN --> SAVE[INSERT audit_verifications<br/>valid/invalid, through-sequence, head hash, counts, failure]
  F1 --> AN
  F2 --> AN
```

Key lines:

| Lines | What |
|---|---|
| [L34](../../apps/api/src/audit/audit-integrity.service.ts#L34) | Incremental runs start from the last **valid** row in `audit_verifications` |
| [L36-L39](../../apps/api/src/audit/audit-integrity.service.ts#L36-L39) | Respect the newest archive base; never resume from before it |
| [L42](../../apps/api/src/audit/audit-integrity.service.ts#L42) | Batches of 5,000 (`BATCH`) keep memory flat |
| [L46](../../apps/api/src/audit/audit-integrity.service.ts#L46) | Link check |
| [L47-L49](../../apps/api/src/audit/audit-integrity.service.ts#L47-L49) | Recompute v2 hash from the stored row |
| [L55](../../apps/api/src/audit/audit-integrity.service.ts#L55) | Anchors are checked even if the chain looked fine |
| [L57](../../apps/api/src/audit/audit-integrity.service.ts#L57) | Result persisted (the table itself is insert-only for the app) |
| [L58](../../apps/api/src/audit/audit-integrity.service.ts#L58) | Loud `AUDIT INTEGRITY FAILURE` log line |

**Verification never "repairs" anything.** Evidence of tampering is evidence.

### Incremental vs full

| Mode | When | Cost | Blind spot |
|---|---|---|---|
| Incremental (`verify()`) | Hourly from the scheduler, "Verify new events" button | Only new events | Cannot see an edit to an event that was already verified |
| Full (`verify(true)`) | Daily, before every anchor, "Full re-verification" button | Whole live table | None within the live table |

The scheduler's cadence is at [workflow-scheduler.ts#L50-L53](../../apps/api/src/workflow/workflow-scheduler.ts#L50-L53): if more than 24 h since the last anchor → `anchor()` (which runs a full verify); else if more than 1 h since the last verify → incremental.

---

## 3. Why anchors are necessary

Delete the last 10 events. Every remaining event still links correctly to its predecessor, so the chain is **internally valid**, just shorter. Linkage alone cannot see it.

```mermaid
flowchart LR
  subgraph Before
    a1[..] --> a2["seq 900<br/>H900"] --> a3["seq 901..910"]
  end
  subgraph Anchor["Anchor stored outside DB"]
    X["seq 910 = H910"]
  end
  subgraph After["After attacker deletes 901-910"]
    b1[..] --> b2["seq 900<br/>H900 (looks fine)"]
  end
  X -. "event 910 missing → MISMATCH" .-> b2
```

`checkAnchors` ([L97-L111](../../apps/api/src/audit/audit-integrity.service.ts#L97-L111)):

```sql
SELECT a.sequence FROM audit_anchors a LEFT JOIN audit_events e ON e.sequence = a.sequence
WHERE a.sequence > COALESCE((SELECT max(sequence) FROM audit_chain_bases), 0)
  AND e.event_hash IS DISTINCT FROM a.head_hash
```

`IS DISTINCT FROM` treats a **missing** event (NULL) as a mismatch, so deletion and rewrite are both caught. Anchors older than the archive base are skipped, because those events were archived on purpose.

The test [workflow.integration-spec.ts#L196](../../apps/api/test/workflow.integration-spec.ts#L196) does exactly this: it anchors, deletes the tail, and asserts `failureReason` mentions the anchor.

---

## 4. Publishing an anchor

[audit-integrity.service.ts#L81-L95](../../apps/api/src/audit/audit-integrity.service.ts#L81-L95):

1. `verify(true)`: only a head that has **just verified clean** is anchored.
2. Skip if the chain is empty or has not grown since the last anchor.
3. `signAnchor(sequence, headHash, createdAt)`: Ed25519 signature if a private key is configured.
4. `storage.putJson('audit-anchors/000000000910.json', {...})`: written to object storage, ideally with Object Lock. A storage failure gives `objectKey = null`, which makes the anchor weaker but not lost.
5. In **one transaction**: INSERT `audit_anchors`, write `audit.anchor_created` audit, enqueue an outbox event (so the bank's bus or SIEM gets a copy too).

**Plain:** we take a fingerprint of the latest page, seal it, and post copies to two places the database administrator does not control.

---

## 5. Signing

[anchor-signer.ts](../../apps/api/src/audit/anchor-signer.ts):

```ts
export const anchorMessage = (sequence, headHash, signedAt) => Buffer.from(`audit-anchor:v1:${sequence}:${headHash}:${signedAt}`);
export function signAnchor(...) { const key = pem(process.env.AUDIT_ANCHOR_SIGNING_PRIVATE_KEY); return key ? sign(null, anchorMessage(...), createPrivateKey(key)).toString('base64') : null; }
export function verifyAnchorSignature(...) { const key = pem(process.env.AUDIT_ANCHOR_PUBLIC_KEY); if (!key) return null; ... return verify(null, msg, createPublicKey(key), sig); }
```

- `sign(null, ...)`: for Ed25519, Node takes `null` as the digest algorithm because Ed25519 hashes internally.
- The message is **versioned and prefixed** (`audit-anchor:v1:`), so a signature over another kind of message can never be replayed as an anchor signature (domain separation).
- `pem()` accepts `\n`-escaped PEMs so keys can be injected from a vault as one-line env vars.
- Generate keys: `node apps/api/scripts/generate-anchor-keys.mjs`. Give the platform only the private key; give auditors the public key.

### The "strip the signature" attack
[L102-L108](../../apps/api/src/audit/audit-integrity.service.ts#L102-L108): once **any** anchor has a signature, every later anchor must too. Otherwise an attacker could forge an anchor and simply leave it unsigned. Unsigned anchors are accepted only *before* the first signed one (from before signing was switched on).

---

## 6. Archiving old events

Production audit tables grow forever. [audit-archive.ts#L20-L57](../../apps/api/src/audit/audit-archive.ts#L20-L57), run by the **owner** account through [scripts/archive-audit.mjs](../../apps/api/scripts/archive-audit.mjs):

```bash
MIGRATION_DATABASE_URL=postgresql://case_owner:...@host/db node apps/api/scripts/archive-audit.mjs --through 100000 --out /secure/archive
```

In one transaction:

1. Refuse if it would archive the newest event ([L26](../../apps/api/src/audit/audit-archive.ts#L26)); something must remain to link to.
2. **Re-verify** the range being archived (links + v2 hashes). Refuse to archive an already-damaged trail ([L38-L39](../../apps/api/src/audit/audit-archive.ts#L38-L39)).
3. Stream events to a JSON-lines file while hashing it ([L40-L41](../../apps/api/src/audit/audit-archive.ts#L40-L41)); backpressure-aware (`drain`).
4. Write a manifest with count, through-sequence, last hash, previous base hash and file SHA-256 ([L48](../../apps/api/src/audit/audit-archive.ts#L48)).
5. INSERT into `audit_chain_bases` ([L49](../../apps/api/src/audit/audit-archive.ts#L49)).
6. `DISABLE TRIGGER USER` → DELETE → `ENABLE TRIGGER USER` ([L50-L52](../../apps/api/src/audit/audit-archive.ts#L50-L52)), only inside this transaction.
7. COMMIT. On any error: ROLLBACK, so the triggers were never actually off for anyone else.

`acceptExistingStart` ([L64-L73](../../apps/api/src/audit/audit-archive.ts#L64-L73)) is a last resort for a trail whose first events are already missing. It is a **documented human decision** to accept that earlier history can't be verified.

---

## 7. Status, anchors API and metrics

| Surface | What | Code |
|---|---|---|
| `GET /audit/chain-status` | Latest verification + latest anchor | [audit.controller.ts#L16-L17](../../apps/api/src/audit/audit.controller.ts#L16-L17), `latest()` [L62-L69](../../apps/api/src/audit/audit-integrity.service.ts#L62-L69) |
| `POST /audit/verify?full=true` | Run now; the run itself is audited (`audit.verification_run`) | [L20-L26](../../apps/api/src/audit/audit.controller.ts#L20-L26) |
| `GET /audit/anchors` | Up to 200 anchors, `storedExternally` flag | [L28-L29](../../apps/api/src/audit/audit.controller.ts#L28-L29) |
| Prometheus | `audit_chain_valid`, `audit_chain_verified_sequence`, `audit_chain_last_verified_timestamp_seconds`, `audit_runtime_role_safe` | [metrics.service.ts#L24-L29](../../apps/api/src/metrics/metrics.service.ts#L24-L29), [L51-L53](../../apps/api/src/metrics/metrics.service.ts#L51-L53) |

Alert on `audit_chain_valid == 0` or `audit_runtime_role_safe == 0`. See [operations/runbooks.md](../operations/runbooks.md).

---

## 8. Configuration reference

| Env var | Default | Effect |
|---|---|---|
| `AUDIT_INTEGRITY_ENABLED` | on | `false` disables scheduled verify/anchor |
| `AUDIT_ANCHOR_SIGNING_PRIVATE_KEY` | unset | Sign anchors |
| `AUDIT_ANCHOR_PUBLIC_KEY` | unset | Verify signatures (else signatures are not checked) |
| `AUDIT_STREAM_ENABLED` / `AUDIT_STREAM_INCLUDE_METADATA` | off | SIEM stream through the outbox |
| `AUDIT_REQUIRE_RESTRICTED_DB_ROLE` | off (required in production) | Refuse to start as an audit-capable role |
| `AUDIT_LIST_VIEWS` | on | `false` stops auditing list/search views |

Next: [Database protection](database-protection.md)
