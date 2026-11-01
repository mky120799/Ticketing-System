# Receipts and operations

[Back to Outbox index](README.md)

---

## 1. Downstream receipts

A downstream system (CRM, data platform) can confirm it processed an event:

`POST /v1/integrations/outbox/:eventId/receipts` `{ externalSystem, externalReference, outcome: accepted|rejected, payloadHash? }`, needing `integration:reconcile` (the `integration-reconciler` robot role) → [recordReceipt, integration.service.ts#L15-L32](../../apps/api/src/integrations/integration.service.ts#L15-L32):

```text
lock the outbox row FOR UPDATE
must be 'published' (you can't confirm what we haven't sent) → else 409
existing receipt for (event, externalSystem)?
   identical (reference, outcome, hash) → return it, replayed: true      (idempotent retry)
   different                            → 409 "A different receipt already exists"   (contradiction)
insert integration_receipts, audit integration.receipt_recorded
```

The unique constraint `(outbox_event_id, external_system)` ([migration …12000](../../apps/api/migrations/1710000012000_integration_receipts.cjs)) is the database-level guarantee.

**Plain:** a receipt is a signed delivery note. Sending the same note twice is fine; sending a *different* note for the same parcel is a red flag.

## 2. Dead-letter operations

[outbox-admin.service.ts](../../apps/api/src/operations/outbox-admin.service.ts) + [controller](../../apps/api/src/operations/outbox-admin.controller.ts), all `configuration:write` (administrators):

| Route | What | Lines |
|---|---|---|
| `GET /v1/operations/outbox/summary` | Count by status | [L15-L19](../../apps/api/src/operations/outbox-admin.service.ts#L15-L19) |
| `GET /v1/operations/outbox/events?status=dead_letter&limit=` | Metadata only (type, aggregate, attempts, error category, times), **no payload**, ≤ 200 | [L21-L27](../../apps/api/src/operations/outbox-admin.service.ts#L21-L27) |
| `POST /v1/operations/outbox/events/:id/replay` | Move one dead letter back to `retry`, attempts reset | [L30-L40](../../apps/api/src/operations/outbox-admin.service.ts#L30-L40) |
| `POST /v1/operations/outbox/replay` `{ eventType? }` | Replay up to 500 (optionally of one type), `FOR UPDATE SKIP LOCKED` | same |

```sql
UPDATE integration_outbox SET status='retry', attempts=0, next_attempt_at=now(), last_error=NULL, claimed_at=NULL
WHERE id=$1 AND status='dead_letter' RETURNING id
-- 0 rows for a single id → 404 "That event is not in the dead-letter queue"
```

- Only `dead_letter` rows can be replayed, never `in_flight` or `published` ones.
- Each replay writes `outbox.replayed` audit with the count and type filter.
- Test: [workflow.integration-spec.ts#L292](../../apps/api/test/workflow.integration-spec.ts#L292): supervisor 403, admin sees the dead letter without payload, replay → `retry`/0 attempts, second replay → 404, audit written.

### Runbook (short)

1. See dead letters rising (metric or admin screen).
2. Fix the cause (bus down, credentials, topic ACL).
3. Replay **one** event, confirm it publishes (and a receipt arrives, if expected).
4. Replay all, or one event type at a time.

Full runbook: [operations/runbooks.md](../operations/runbooks.md).

## 3. Admin screen

[integration-section.tsx#L20-L64](../../apps/web/src/features/admin/sections/integration-section.tsx#L20-L64): tiles per status (dead letter in red if > 0), a dead-letter table with per-row **Replay**, **Replay all**, and Refresh. The comment explains the pattern in plain words ([L1-L7](../../apps/web/src/features/admin/sections/integration-section.tsx#L1-L7)).

"Replay" means "make it eligible for dispatch again", **not** "the bus has received it".

## 4. Metrics

`outbox_events{status}` gauge for pending, in_flight, retry and dead_letter, computed from the table at scrape time ([metrics.service.ts#L41-L43](../../apps/api/src/metrics/metrics.service.ts#L41-L43)). Alert when `dead_letter > 0` or `pending` keeps growing. Alert rules: [deploy/monitoring/alert-rules.yaml](../../deploy/monitoring/alert-rules.yaml).

## 5. Interview answer

> Downstream systems can post receipts as a narrow machine role. The service locks the outbox row, accepts receipts only for published events, and uses a unique (event, system) key, so an exact retry replays the stored receipt and a contradictory one is a 409. Failed events dead-letter after five attempts. Administrators see metadata, never payloads, and replay one or a bounded batch with skip-locked selection; each replay is audited, and only dead letters can be replayed.

Next: [Event catalogue](event-catalogue.md) · [Interview Q&A](interview-qa.md)
