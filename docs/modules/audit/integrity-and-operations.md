# Audit integrity and operations

Append-only permissions stop normal application tampering; hash-chain verification and external anchors detect corruption or deletion that bypasses the application.

## Defense layers

1. A PostgreSQL trigger rejects update/delete mutation of `audit_events`.
2. The runtime `case_app` role is not owner/superuser and cannot update, delete or truncate the table.
3. Every version-2 event hash covers all stored event fields and the previous event hash.
4. `AuditIntegrityService` recomputes hashes and validates links.
5. Published anchors preserve an external copy of sequence/head hash and can carry Ed25519 signatures.
6. Archive tooling stores JSONL plus manifest/SHA-256 and records a chain base before owner-only pruning.

The hash chain alone detects changes in the middle, but deletion of the newest tail could leave a shorter internally valid chain. An external anchor is what detects that rollback.

## Verification algorithm

[`AuditIntegrityService.verify`](../../../apps/api/src/audit/audit-integrity.service.ts) operates in batches of 5,000. Incremental mode resumes from the last valid verification at or beyond the latest archive base; full mode starts from the base and re-walks all live events.

For each sequence-ordered row it checks:

1. `previous_hash` equals the expected prior head.
2. For hash version 2, `computeEventHashV2(stored fields)` equals `event_hash`.
3. Legacy version-1 rows are link-checked and counted.
4. Published anchors newer than the archive base still match their event.
5. Once signed anchors begin, every later anchor has a valid signature under the configured public key.

The result—valid/invalid, verified-through sequence, head hash, checked/legacy counts and failure location—is persisted in `audit_verifications` and exposed to metrics. Failure is logged prominently; verification never “repairs” evidence.

## Anchoring

`anchor(correlationId)` first performs a full clean verification. It skips an empty/unchanged chain. For a new head it signs `(sequence, headHash, createdAt)` when keys are configured, stores a JSON anchor object in object storage where possible, then transactionally inserts `audit_anchors`, writes `audit.anchor_created` and enqueues a minimized event.

Production object storage should use independent credentials and write-once/Object-Lock retention. If the attacker controls both database and anchor store/keys, the assurance collapses; key custody and access separation are part of the system.

## Protected audit API

[`AuditController`](../../../apps/api/src/audit/audit.controller.ts) uses `AuthGuard` and `audit:read`:

| Route | Behavior |
|---|---|
| `GET /audit/chain-status` | Latest verification and anchor |
| `POST /audit/verify?full=true` | Run verification and audit the run |
| `GET /audit/anchors` | List bounded anchor metadata |
| `GET /audit/events` | Scoped cursor search |
| `GET /audit/tickets/:ticketId` | Ticket report after ticket access check |
| `GET /audit/tickets/:ticketId/export` | Same with step-up and export evidence |

Cross-ticket search joins events to tickets and filters legal entity, country and queues before return. It escapes action-prefix wildcard characters and uses sequence cursor pagination. Searches, report views, exports and verification runs write their own audit events.

## Scheduler and monitoring

Workflow scheduling verifies hourly and anchors daily by default unless `AUDIT_INTEGRITY_ENABLED=false`. Metrics expose valid/invalid state, verified sequence/time and runtime-role safety. Alerts should treat invalid verification or unsafe role as high severity and preserve database/storage snapshots before investigation.

## Interview answer

> I protect audit evidence with database immutability, a hash chain and external signed anchors. Verification walks rows in sequence, checks linkage, recomputes version-2 hashes and compares published anchors; anchors detect deletion of the latest tail. The API runtime role cannot rewrite the table, while owner-only archive jobs preserve a chain base. Audit searches are themselves scoped and audited, and exports require step-up.
