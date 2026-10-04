# Deployment guide

The platform is two stateless containers (API and web console) plus PostgreSQL. Everything bank-specific is configuration; the same images run for every bank.

## Artifacts

| Artifact | Source | Notes |
|---|---|---|
| API image | `apps/api/Dockerfile` | Node 22, non-root (uid 1000), read-only root filesystem compatible, ~74 MB compressed. Also contains the migrations and `scripts/migrate.mjs`. |
| Web image | `apps/web/Dockerfile` | `nginx-unprivileged` (uid 101), static console. Deployment settings are generated into `/config.js` from environment variables at start-up, so the image is not rebuilt per bank. |
| Helm chart | `deploy/helm/bank-case` | Deployments, services, ingress, HPA, PodDisruptionBudget, NetworkPolicies, migration hook job, optional ServiceMonitor. |
| Local stack | `docker-compose.yml` | `docker compose up -d` (Postgres, Redis, Keycloak); add `--profile app --build` for the application. |

## Local demo (one command)

```bash
docker compose --profile app up -d --build        # then open http://localhost:5173
# Sign in as local-supervisor / local-admin / local-auditor / local-case-agent / local-branch-agent
# password: local-dev-only-change-me   (development realm only)
npm run intake:simulate --workspace=@bank-case/api   # pretend an email arrived
```

If you used an earlier version of this repository, recreate Keycloak so it imports the current realm: `docker compose up -d --force-recreate keycloak`.

## Kubernetes / OpenShift install

1. **Create the secret** (from Vault, External Secrets, Sealed Secrets or similar). The chart never creates secrets from values.
   Keys: `DATABASE_URL` (required), `REDIS_URL`, `METRICS_TOKEN`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
2. **Write an overlay** with at least: `image.registry`, `ingress.host`, `oidc.issuer`, `oidc.jwksUri`, `config.objectStorage.*`, `existingSecret`.
3. **Install:**
   ```bash
   helm upgrade --install cases deploy/helm/bank-case -n cases --create-namespace -f bank-values.yaml
   ```
   Migrations run first as a Helm pre-install/pre-upgrade hook job; a failed migration blocks the rollout.
4. **Verify:** `GET /v1/health/ready` (database reachable), then sign in.

### Runtime topology

- One host: `/v1` goes to the API, everything else to the web console, so the browser needs no CORS. SSE streams need proxy buffering off and a long read timeout; the chart sets these for ingress-nginx and other controllers need the equivalent.
- The API is safe to run with any number of replicas: outbox claiming uses `FOR UPDATE SKIP LOCKED`, the timer uses a Postgres advisory lock, live events are fanned out per replica through `LISTEN/NOTIFY`, and idempotency is enforced in the database.
- Pods run as non-root with all capabilities dropped, a read-only root filesystem, `RuntimeDefault` seccomp, no service-account token, and a default-deny NetworkPolicy. The chart's egress rules are deliberately broad on ports (443, 5432, 6379, 9092); **tighten them to your database, Redis, IdP, object-storage and bus CIDRs**. Allow your Prometheus namespace to reach the API if you scrape metrics.

## Configuration reference

See `apps/api/.env.example` and `deploy/helm/bank-case/values.yaml`. Notable switches:

| Setting | Default | Meaning |
|---|---|---|
| `OUTBOX_DISPATCHER_ENABLED` / `OUTBOX_PUBLISHER` | true / log | Drain the outbox; `kafka` sends to the bank's bus (`KAFKA_BROKERS`). |
| `WORKFLOW_SCHEDULER_ENABLED` | true | SLA timer, regulatory clocks, escalation. |
| `RETENTION_ENFORCEMENT_ENABLED` | **false** | De-identify expired closed tickets. Destructive; enable after the bank approves schedules. |
| `BUSINESS_TIMEZONE` | Australia/Sydney | Business-day maths for regulatory clocks. |
| `METRICS_TOKEN` | unset (endpoint off) | Enables `/v1/metrics` with a bearer token. |
| `TRUST_PROXY` | false (chart: true) | Use the real client IP behind a gateway, for rate limiting. |
| `RATE_LIMIT_PER_MINUTE`, `MAX_BODY_BYTES` | 600, 1 MiB | Backstop limits; the gateway should also limit. |

## Identity provider contract

The API accepts access tokens signed by the configured issuer, with audience `bank-case-api`, and requires these claims for staff: `roles` (or `realm_access.roles`), `branch`, `queues` (array of strings), `department`, `legal_entity`, `country`. Service identities (`attachment-scanner`, `integration-reconciler`, `notification-provider`, `intake-gateway`) need only their role. Missing claims deny access. The web client must use authorization code with PKCE and a redirect URI of the console host. See `infra/keycloak/bank-case-dev-realm.json` for a complete example.

## Backup, recovery and upgrades

- **Data**: everything authoritative is in PostgreSQL (plus attachment objects). Use the bank's managed or operator-based Postgres with point-in-time recovery; set RPO/RTO with the business. The audit chain is hash-linked, so a restore can be verified by recomputing hashes in sequence order.
- **Attachments**: enable object versioning and cross-region replication in the bank's storage per policy. Retention de-identification deletes objects intentionally.
- **Backups and retention**: backups hold pre-redaction data until they expire; align backup retention with the retention policy.
- **Upgrades**: roll forward. Migrations are additive and run before new pods start; `down` migrations exist for development but should not be used in production without a tested restore plan. Rolling updates keep at least the previous capacity (`maxUnavailable: 0`).
- **Disaster recovery exercise**: restore a backup into an empty cluster, run the migration job (no-op at head), start the API, verify `/v1/health/ready` and an audit-chain hash check. Record the measured RTO/RPO as evidence.

## What is not verified here

Container images, the compose stack, the migrations, Keycloak login and the API were run locally. The Helm chart was linted and rendered but not installed on a live cluster. Kafka publishing, object storage with a real bucket, and an enterprise IdP were not exercised.

## Database accounts (required for production)

Run two PostgreSQL accounts, created with `infra/postgres/roles.sql`:

| Account | Used by | Can |
|---|---|---|
| `case_owner` | the migration job only (`MIGRATION_DATABASE_URL`) | own and change the schema |
| `case_app` | the API (`DATABASE_URL`) | read and write case data; **only add and read audit events** |

This makes the audit trail append-only even against a compromised application. Set `AUDIT_REQUIRE_RESTRICTED_DB_ROLE=true` (the chart default) so the API refuses to start under any other account, and alert on the `audit_runtime_role_safe` metric. The same file can grant a read-only `case_reporting` account for BI tools (see the reporting views).

## Audit operations

- **Verification** runs hourly (incremental) and daily (full). Alert on `audit_chain_valid == 0`, on a stale `audit_chain_last_verified_timestamp_seconds`, and on `audit_runtime_role_safe == 0`.
- **Anchors** are published daily to the event bus and, if object storage is configured, as signed objects under `audit-anchors/`. Use a bucket with Object Lock or a SIEM the database administrators cannot alter. Generate signing keys with `node scripts/generate-anchor-keys.mjs`, keep the private key in the vault, and give the platform the public key to verify.
- **Streaming to the SIEM:** `AUDIT_STREAM_ENABLED=true` publishes each audit event to the topic `<prefix>.audit`.
- **Archiving old events:** run `scripts/archive-audit.mjs --through <sequence> --out <dir>` as the owner account; keep the produced `.jsonl` and `.manifest.json` in write-once storage. Never delete audit rows by hand; that is indistinguishable from tampering.
- **After a restore:** `POST /v1/audit/verify?full=true`, then compare with the latest anchor held outside the database.

## Local service map (docker compose)

| Service | URL / port | Start with |
|---|---|---|
| Staff console | http://localhost:5173 | `--profile app` |
| Customer portal | http://localhost:5174 | `--profile app` |
| API | http://localhost:3000/v1 | `--profile app` |
| Keycloak (staff and customer realms) | http://localhost:8080 | default |
| PostgreSQL | localhost:5433 | default |
| Kafka-compatible broker | localhost:19092 | `--profile kafka` |
| Object storage (S3 API) | http://localhost:8333 | `--profile storage` |
| ClamAV | localhost:3310 | `--profile storage` |
| Mail server (SMTP 3025, IMAP 3143) | mailbox `cases` / `cases-secret` | `--profile mail` |

Customer portal demo logins: `local-customer` and `local-customer-2` (password `local-dev-only-change-me`) in the separate customer realm.
