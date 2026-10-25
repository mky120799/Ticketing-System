# Flow: audit search, ticket report, export and integrity verification

The audit UI has two related but distinct paths: cross-ticket scoped search and one-ticket chronological evidence. Export adds step-up authentication, while chain verification proves tamper evidence rather than business meaning.

## Route map

| Route | Purpose | Additional rule |
|---|---|---|
| `GET /v1/audit/events` | newest-first scoped search | validated filters/cursor, max 200 |
| `GET /v1/audit/tickets/:ticketId` | chronological ticket report | current ticket read policy, max 500 |
| `GET /v1/audit/tickets/:ticketId/export` | downloadable JSON evidence | current ticket read policy + step-up |
| `GET /v1/audit/chain-status` | last verification and anchor | `audit:read` |
| `POST /v1/audit/verify?full=true` | run incremental/full verification | run itself is audited |
| `GET /v1/audit/anchors` | published chain heads | `audit:read` |

All routes use `AuthGuard` and then require `audit:read`. The API does not trust that the React audit route was hidden from non-auditors.

## 1. Frontend request

[`audit-page.tsx`](../../apps/web/src/features/audit/audit-page.tsx) submits actor, action prefix, outcome, date range and sequence cursor through the typed API client. TanStack Query keys include the submitted filters so results from different searches do not collide.

[`audit-tab.tsx`](../../apps/web/src/features/ticket/tabs/audit-tab.tsx) loads one ticket's trail. Subject ids are resolved through the scoped Directory for display; stored audit actor ids remain immutable opaque subjects.

## 2. Identity and permission

`AuthGuard` verifies the token and attaches `UserContext`. `AuditController` calls `PolicyService.assertPermission(user, 'audit:read')` for every operation. Export additionally calls `assertStepUp`, which can return a structured `403 step_up_required`; the browser then offers a fresh/strong sign-in.

Authentication, audit permission and ticket visibility are separate decisions.

## 3. Cross-ticket search scope

`AuditSearchQuery` bounds and transforms:

- actor up to 160 characters;
- action prefix up to 100;
- outcome to `success|denied`;
- ISO date range;
- limit 1–200;
- sequence cursor `before >= 1`.

The query joins ticket-targeted events to tickets and requires the current auditor's legal entity, country and queues. Auditors may read restricted tickets but still do not cross queue/entity/country scope. Ticket-list evidence is keyed to the caller's entity/country target.

Action filtering escapes SQL wildcard characters before constructing a prefix LIKE pattern. Values remain query parameters.

After reading, the controller writes a separate `audit.searched` event containing result count and which filter categories were used—not the full result set or sensitive query payload. The response carries bounded event metadata, correlation id and event hash plus `nextBefore` for keyset pagination.

## 4. One-ticket report

The controller first loads the ticket's policy attributes, then calls `assertTicketAccess(user, ticket, 'ticket:read')`. It fetches events whose target or selected metadata references that ticket, ordered oldest-to-newest and capped at 500.

Viewing the report writes `audit.report_viewed`; exporting writes `audit.exported` with event count. Export returns JSON with an export timestamp and saves it in the browser. The generated file is evidence data, so downstream handling/storage policy still matters after download.

If a ticket does not exist, the current report method returns an empty event array. For an existing but inaccessible ticket, policy refuses. Review whether that distinction matches the desired anti-enumeration contract.

## 5. What the event proves

Returned fields include:

```text
id, occurredAt, actorId, action, targetType, targetId,
correlationId, outcome, minimized metadata,
previousHash, eventHash
```

An event proves the application recorded an action/outcome with those normalized fields. A hash chain makes later alteration detectable; it does not prove the original actor/business assertion was truthful by itself. Database least privilege, transactional writes, identity verification and external anchors supply the surrounding assurance.

## 6. Integrity verification

`AuditIntegrityService.verify` walks events by sequence in batches of 5,000:

1. start from archive base or last valid checkpoint for incremental runs;
2. verify each `previous_hash` points to the preceding head;
3. recompute version-2 event hash from stored fields, including timestamp;
4. count legacy version-1 rows that can only be link-checked;
5. verify published anchors still match retained events;
6. verify anchor signatures from the first signed anchor onward;
7. persist verification status and failure sequence/reason.

Incremental verification is cheap but cannot rediscover edits before its checkpoint; scheduled full verification/anchors are required. A daily anchor publishes the verified head through outbox and optionally immutable object storage, detecting deletion/rewrite of the newest tail that linkage alone cannot reveal.

## 7. Frontend behavior

- search uses cursor pagination rather than large offset scans;
- ticket trail renders chronological evidence and chain values;
- display names are decoration only;
- verification status/last anchor are clearly separated from event search;
- export is a deliberate action and can trigger step-up;
- 401 ends the session, 403 does not masquerade as empty data;
- invalid-chain status must be visually prominent and operationally alerted, not silently hidden.

## Failure and limit map

| Condition | Outcome |
|---|---|
| no/invalid token | 401 before query |
| no `audit:read` | 403; denied evidence path applies |
| bad filter/limit/date | 400 via DTO pipe |
| ticket outside scope | policy refusal |
| stale step-up for export | coded 403, no export |
| event query succeeds but audit-of-search fails | current operation fails because evidence write is awaited separately |
| integrity mismatch | persisted invalid status with sequence/reason; operations alert/investigate |
| external anchor storage unavailable | anchor may still persist with `storedExternally=false`; this reduces external evidence strength and needs monitoring |

## Tests that prove the path

- permission and queue/entity/country scoping;
- restricted-ticket auditor read but no mutation;
- filter escaping, range and cursor bounds;
- report view/search/export self-auditing;
- export step-up pass/fail;
- hash recomputation and broken-link/content detection;
- missing tail detected by anchor mismatch;
- signed-anchor verification and legacy behavior;
- append-only database-role integration tests;
- frontend pagination, subject mapping and invalid-chain warning.

## Interview answer

> The audit UI calls guarded, typed endpoints; the server requires `audit:read` and scopes cross-ticket SQL to the auditor's entity, country and queues. A ticket report first applies the normal ticket-read policy, and export additionally requires recent/strong authentication. Every search, view and export is itself audited. Responses include actor/action/correlation/minimized metadata and chain hashes, while the frontend resolves names only for display. Integrity verification walks sequence links, recomputes v2 hashes, verifies anchors/signatures and persists an invalid failure point; scheduled external anchors detect tail deletion. The database runtime role can append but cannot update/delete/truncate audit events, so the hash chain is defense in depth rather than the only control.
