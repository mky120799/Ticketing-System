# Disaster recovery

The platform's state lives in **PostgreSQL** (cases, audit, configuration, outbox) and **object storage** (attachments, signed audit anchors, scheduled reports). Everything else (API, console, portal) is stateless and rebuilt from images. The bank sets the targets; this document defines what must be protected and how recovery is proven.

## Targets to agree with the business

| Item | Typical starting point | Mechanism |
|---|---|---|
| RPO (data you can lose) | minutes | PostgreSQL point-in-time recovery from continuous WAL archiving; synchronous or near-synchronous replica |
| RTO (time to restore service) | 1-4 hours | warm standby or restore into a pre-provisioned cluster; images already in the registry |
| Attachments | no loss | object versioning and cross-region replication; Object Lock where policy requires |
| Audit anchors | no loss, not alterable by database administrators | Object Lock bucket and/or the SIEM copy of the anchor events |

## What to back up

1. **PostgreSQL** with base backups plus WAL for point-in-time recovery, encrypted, in a different failure domain; retention at least as long as the longest data-retention obligation, and **aligned with the retention policy** (a backup contains data the platform has since de-identified until it expires).
2. **Object storage buckets** (attachments, `audit-anchors/`, `reports/`).
3. **Configuration as code**: the Helm values overlay, secrets in the vault (including the audit signing key and the roles script passwords), and the identity provider configuration (realms, clients, claim mappings).
4. **Audit archives** written by `scripts/archive-audit.mjs` (files and manifests) in write-once storage.

## Recovery procedure

1. Provision PostgreSQL (restore the base backup, replay WAL to the target time). Provision object storage or point at the replica.
2. Recreate the two database accounts if needed (`infra/postgres/roles.sql`).
3. Deploy the chart. The migration job runs as the owner account and is a no-op when the schema is current.
4. Start the API. Confirm `/v1/health/ready`, sign in as each role, open a recent ticket.
5. **Prove the audit trail is intact:** `POST /v1/audit/verify?full=true` must report `valid`. Then compare the head with the **latest anchor held outside the database** (object storage / SIEM). A restore to an older point will fail the anchor check; this is expected and tells you exactly how much history was lost.
6. Check the outbox: events written before the failure may be republished (consumers de-duplicate on `eventId`); look for dead letters and replay them.
7. Let the scheduler run once: SLA and regulatory statuses recompute, and any deadline that passed during the outage is flagged and escalated.
8. Record the measured RTO and RPO as exercise evidence.

## Regional failover notes

The API and workers are safe to run in several places at once (row-locking and advisory locks coordinate them), but there is exactly **one PostgreSQL primary**. In a failover, promote the standby, point `DATABASE_URL` at it, and re-run step 5. The timer and workers resume by themselves; email intake resumes from the unread messages in the mailbox.

## Exercise schedule

Run a full restore exercise at least twice a year and after any major change: restore into an empty environment, run steps 2-8, and file the timings. The first exercise is a go-live gate (see `production-readiness.md`).

## Known limits

Backups are only as good as the last restore test. The platform does not manage backups itself; they are the bank's database service. A compromise of both the database and the anchor store would defeat tamper detection, which is why the anchor store must be separately controlled.
