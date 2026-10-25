# Failure and test map

[Reference index](README.md) · [Data and consistency](data-and-consistency-map.md) · [Interview answers](../../interview-prep/module-answers.md)

This table identifies the failure that defines each module's trust boundary and the smallest honest test that can prove it. “Test” means required evidence; some rows describe hardening coverage to add, not necessarily a test already present.

## Module-by-module proof map

| Module/area | Decisive failure behavior | Strongest necessary proof |
|---|---|---|
| App/bootstrap | unsafe production settings refuse startup; malformed/large/over-rate requests stop before business work | production-safety unit matrix plus HTTP app-factory E2E for plugins/global pipe |
| Auth | forged/wrong issuer/audience/algorithm/expired/revoked token yields 401 and no `UserContext` | generated asymmetric key + real JWKS signed-token tests; hardening negative cases |
| Authorization | valid identity outside permission/scope/sensitivity/maker-checker gets 403/hidden 404 by contract | pure policy branch table plus service integration with current resource |
| Audit | business mutation cannot commit without success evidence; runtime role cannot alter history | forced audit failure transaction test plus real PostgreSQL role/trigger test |
| Audit integrity | changed link/content/tail/signature becomes persisted invalid status | seeded chain corruption and anchor/signature integration tests |
| Database | timeout/error rolls back and releases connection; shutdown drains pool | integration test around transaction error plus lifecycle test |
| Cache | Redis outage never grants access or becomes source of truth | fake/real Redis outage tests comparing fallback result and scoped keys |
| Tickets create/read | duplicate logical create does not create duplicate; list/read never cross actor scope | PostgreSQL idempotency race + scoped query/service tests |
| Ticket mutation | stale/concurrent write has one documented winner; audit/outbox atomic | synchronized DB clients plus rollback injection; current implementation exposes a hardening gap |
| SLA/business time | holidays/hours/pause/resume produce correct deadlines at boundaries | deterministic clock/calendar units plus reconciliation integration |
| Assignment | concurrent automatic assignment is serialized and scoped; submitted assignee is valid member | concurrent DB test under queue lock; add manual membership integration coverage |
| Workflow | invalid graph/edge/role is refused and no partial replacement/state change commits | definition validation units plus transition DB integration |
| Escalation | repeated/concurrent tick applies one rule once | two scheduler/service clients and unique claim assertion |
| Retention | legal hold always blocks destructive deletion/redaction; retries converge | state-machine DB + fake object-store failure/race tests; current pre-lock delete race must be fixed first |
| Attachments/storage | file is downloadable only after matching checksum and clean scan | object-store/ClamAV integration plus state transition tests; concurrent claim test after lease hardening |
| Upload capability | expired/revoked/wrong-object token yields uniform safe refusal | token signature/expiry tests plus HTTP endpoint non-enumeration E2E |
| Intake | same source id/body replays; same id/different body conflicts; all ticket setup is atomic | real DB exact/conflicting/concurrent idempotency integration |
| Portal | customer cannot read/reply/upload against another customer's request | separate signed customer tokens and ownership integration tests |
| Email inbound | failure leaves message retriable; sender cannot attach to unowned reference | fake IMAP/message integration with ownership/idempotency assertions |
| Email outbound | provider crash/retry cannot move status backward or create contradictory receipt | lease/retry unit + provider/receipt database integration |
| Outbox | committed business event is not lost; competing workers claim disjoint rows; duplicates are tolerated | PostgreSQL transaction/claim/crash-window tests plus broker idempotency integration |
| Integrations | exact callback retry is idempotent; contradictory retry is 409; state only advances | concurrent receipt integration with unique keys and rank assertions |
| Live events | rollback sends no hint; inaccessible subscriber gets none; reconnect forces resync | PostgreSQL LISTEN/NOTIFY integration and policy-filtered subscriber tests |
| Notifications | audience/read state cannot cross user/entity/country and does not grant ticket access | seeded scoped inbox/read integration plus revoked-ticket navigation E2E |
| Dashboard | aggregates include only current actor scope and controlled dimensions | seeded multi-scope SQL integration with known counts |
| Configuration | invalid/unauthorized replacement cannot partially change active configuration | DTO/policy E2E and transaction integration with audit before/after evidence |
| Compliance | regulatory clocks/outcomes/exports remain scope-correct across calendar boundaries | deterministic business-calendar units plus multi-scope report integration |
| Metrics | token-disabled endpoint is hidden and labels never contain concrete ids | controller E2E plus registry assertion for bounded labels |
| Operations | only dead letters replay, batch is bounded/concurrency-safe and recovery is audited | permission E2E plus two-client skip-locked/audit rollback integration |
| Directory | machine/cross-entity lookup is denied/omitted; name failure does not block login | service units/integration plus `/me` directory-failure test |

## Existing test anchors

| Test file | Important evidence |
|---|---|
| `auth.guard.spec.ts` | real RSA/JWKS signature, expiry, claims and service identity |
| `auth-hardening.spec.ts` | algorithm/client/revocation/entitlement/step-up refusal paths |
| `security.policy.spec.ts` | queue, restricted sensitivity, auditor read-only, admin default deny, maker-checker |
| `unauthenticated.e2e-spec.ts` | real module/controller/guard HTTP 401 behavior |
| `roles.integration-spec.ts` | effective PostgreSQL audit/reporting least privilege |
| `ticket.integration-spec.ts` | ticket persistence/domain paths with real database |
| `portal.integration-spec.ts` | customer portal ownership/lifecycle paths |
| `workflow.integration-spec.ts` | workflow configuration/scheduler behavior |
| `email.integration-spec.ts` | email processing/delivery behavior |
| `storage.integration-spec.ts` | object storage adapter behavior |
| `kafka.integration-spec.ts` | publisher/envelope/broker integration |
| `business-calendar.spec.ts` | deterministic business-time calculations |
| `redis-cache.service.spec.ts` | cache behavior/fallback contracts |
| `attachment-storage.service.spec.ts` | adapter-level storage logic |
| `upload-link-token.spec.ts` | capability token integrity/expiry semantics |
| `production-safety.spec.ts` | unsafe production configuration refusal |

Read each file before claiming its guarantee. A filename such as “integration” does not automatically mean every external dependency or concurrency window is exercised.

## Refusal-first test design

For each operation, build this sequence:

1. no identity;
2. malformed/forged identity;
3. valid identity without permission;
4. permission but outside resource scope;
5. valid scope but invalid DTO;
6. valid input but invalid current state;
7. stale/concurrent request;
8. dependency failure during the transaction;
9. success;
10. retry after ambiguous client/network outcome.

This order catches bypasses and clarifies which layer owns each status.

## What mocks cannot prove

| Claim | Why a mock is insufficient |
|---|---|
| `FOR UPDATE SKIP LOCKED` divides work | requires real database locks and overlapping transactions |
| audit and mutation roll back together | requires real transaction/connection behavior |
| DB role cannot truncate/drop/update | requires effective PostgreSQL privileges/ownership/triggers |
| unique key resolves race | requires real constraint under concurrency |
| Kafka accepts/idempotent producer behavior | requires broker integration |
| S3 presigned URL/permissions work | requires compatible object-store integration |
| OIDC browser redirect/callback works | requires browser + configured IdP/system test |
| React Query invalidation updates screen | requires frontend hook/component behavior, not backend unit |

Mocks still belong in small tests that prove orchestration/branching. State the boundary they replace.

## Interview proof sentence

For any module:

> The decisive failure is **X**. A unit test proves **pure decision Y**, an HTTP E2E test proves **wiring/status Z**, and a real **database/broker/browser** integration test proves the concurrency or external guarantee that a mock cannot. The current unproven or known limitation is **L**.

Examples:

- Outbox: two real DB clients prove disjoint skip-locked claims; a fake publisher proves retry branch logic; broker integration proves envelope/key behavior; consumer idempotency still owns duplicate delivery.
- Authentication: generated keys and local JWKS prove cryptographic checks; Nest E2E proves route binding; only a real browser/IdP proves deployed callback and SSO policy.
- Ticket update: policy unit proves access; DB integration must prove conditional version winner; frontend test proves a 409 refetch preserves the user's draft.

This framing is stronger than saying “we had 90% coverage” because it ties evidence to a concrete guarantee.
