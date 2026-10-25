# Operations runbooks

Short procedures for the situations the platform is built to surface. Each one names the signal, what it means, and what to do. Metrics are at `GET /v1/metrics` (needs `METRICS_TOKEN`). "Admin" means a user with the administrator role.

## Alerts to configure first

| Signal | Condition | Severity | Runbook |
|---|---|---|---|
| `audit_chain_valid` | == 0 | **Critical** | [Audit integrity failure](#audit-integrity-failure) |
| `audit_runtime_role_safe` | == 0 | High | [Wrong database account](#wrong-database-account) |
| `audit_chain_last_verified_timestamp_seconds` | older than 3 hours | High | [Verification stopped](#verification-stopped) |
| `outbox_events{status="dead_letter"}` | > 0 for 15 min | High | [Dead-lettered events](#dead-lettered-events) |
| `outbox_events{status="pending"}` | growing for 10 min | Medium | [Events not leaving](#events-not-leaving) |
| `communications{status="queued"}` | not draining for 15 min | Medium | [Messages not sending](#messages-not-sending) |
| `tickets_open{sla_status="breached"}` | rising / above target | Business | [Deadlines being missed](#deadlines-being-missed) |
| `http_requests_total{status=~"5.."}` | error ratio above 1% | High | [Elevated errors](#elevated-errors) |
| Readiness probe `/v1/health/ready` | failing | High | [API not ready](#api-not-ready) |

## Audit integrity failure
**Meaning:** the verifier found a broken link, an event that doesn't match its hash, a missing anchored event, or a bad anchor signature. The status endpoint (`GET /v1/audit/chain-status`) names the failing sequence and reason.
1. **Do not modify the database or "fix" rows.** Treat it as a security incident: notify the security team and preserve evidence.
2. Take a database snapshot now. Note the failing sequence, reason, and time of the last good verification.
3. Run `POST /v1/audit/verify?full=true` once to confirm (an incremental run can miss old changes).
4. Compare against the latest anchor in object storage / the SIEM stream. If events after the anchor differ, the SIEM copy is the authoritative record.
5. Check database administrator and application activity around the failing event's time (database audit logs, the SIEM `audit.event` stream).
6. If the cause is operational (for example a restore from backup), see [disaster-recovery.md](disaster-recovery.md); record the accepted base only after a human decision (`archive-audit.mjs --accept-start`).

## Wrong database account
The API is running as an account that can change audit rows. Re-create the accounts from `infra/postgres/roles.sql`, point `DATABASE_URL` at `case_app`, keep `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` so it can't start otherwise.

## Verification stopped
The scheduler (`WORKFLOW_SCHEDULER_ENABLED`) isn't running or the API instance holding the lock is stuck. Check API logs for `Timer tick failed`; confirm at least one replica is healthy; run `POST /v1/audit/verify` manually; restart the API pods.

## Dead-lettered events
Events failed five publish attempts (the bank's bus was down or rejected them).
1. Administration > Integration events shows each failed event and its last error (or `GET /v1/operations/outbox/events`).
2. Fix the cause (bus availability, credentials, topic permissions).
3. **Replay** from the same screen (one event or all). Replays are audited. Consumers de-duplicate on `eventId`, so republishing is safe.

## Events not leaving
`outbox_events{status="pending"}` rising means the dispatcher isn't publishing. Check `OUTBOX_DISPATCHER_ENABLED=true`, the publisher setting (`OUTBOX_PUBLISHER=kafka`, `KAFKA_BROKERS`), and the API log for `Outbox dispatch failed`. Rows stuck `in_flight` after a crash are released automatically after `OUTBOX_STALE_SECONDS` (default 5 minutes).

## Messages not sending
Queued customer communications are sent by the delivery worker.
- Check `SMTP_HOST` / `SMS_GATEWAY_URL` and credentials; look for `Delivery attempt N failed` in the API log. Retries back off from 30 seconds; after 5 attempts the message is recorded `failed` with a failure code (`DELIVERY_FAILED`, `NO_CONTACT`, `COMMUNICATION_BLOCKED`, `TEMPLATE_INCOMPLETE`).
- `NO_CONTACT` means the contact lookup (`CRM_CONTACT_URL`) returned nothing for that customer reference.
- A communication on a case with a communication block is deliberately failed, not sent.

## Email not arriving as tickets
Check `IMAP_*` settings and that the mailbox has unread messages; the inbound worker logs `Could not process a message, will retry`. Automatic mail (auto-replies, bounces, bulk, list mail) and senders over the hourly limit (`EMAIL_MAX_TICKETS_PER_SENDER_HOUR`) are ignored by design. A channel adapter needs an active `email` intake channel (Administration > Intake channels).

## Attachments stay "pending scan"
Downloads are blocked until a clean scan, so a scanner outage never releases a file. Check `CLAMAV_HOST` / `CLAMAV_PORT`, that clamd has finished loading signatures, and the API log for `Scan failed for attachment`. A checksum mismatch is recorded as a scan error and stays blocked.

## Deadlines being missed
The scheduler recomputes SLA and regulatory status every minute (`WORKFLOW_TICK_MS`). If `tickets_open{sla_status="breached"}` rises, look at queue workload on the dashboard, escalation rules (Administration), and whether queues have active members for auto-assignment. Complaints approaching their final-response date raise notifications to the assignee and the queue's supervisors.

## Elevated errors
Look first at the correlation ID in the failing response / log line; it ties to audit events. Common causes: database connection pool saturation (look for `timeout exceeded when trying to connect`: raise `DATABASE_POOL_MAX` within the database limit or add replicas), the identity provider unreachable (token verification and introspection fail closed), or a bad deployment (roll back with `helm rollback`).

## API not ready
`/v1/health/ready` checks the database. Verify the database is reachable and the `case_app` account can log in. If a migration is pending the pre-upgrade hook job will have failed; check its logs.

## Identity provider outage
Staff and customers cannot sign in; existing sessions continue until token expiry. With token introspection enabled (`AUTH_INTROSPECTION_URL`) the API **fails closed**, so an IdP outage also blocks existing tokens after the cache window. Decide per bank whether to set `AUTH_INTROSPECTION_FAIL_OPEN=true` during an outage (weaker revocation) or accept the interruption.

## Routine procedures
- **Rotate secrets:** update the vault entries and restart pods (secrets are read at start-up). Rotating the audit signing key: publish the new public key to verifiers; anchors signed with the old key stay valid for their sequence range.
- **Archive old audit events:** see `deployment.md`; run as the owner account, store files in write-once storage.
- **Enable retention de-identification:** only after the bank approves schedules; set `RETENTION_ENFORCEMENT_ENABLED=true`; first run on the staging copy. De-identification cannot be undone.
- **Add a bank holiday / change a regulatory profile / edit a workflow:** Administration screens; every change is audited with the previous value.
- **Upgrade:** `helm upgrade`; the migration job runs first and a failure blocks the rollout; rolling updates keep full capacity. Roll back with `helm rollback` (migrations are additive, so the previous version keeps working).
