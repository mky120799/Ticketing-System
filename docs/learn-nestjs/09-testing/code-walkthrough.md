# Lesson 9 code walkthrough: what each test actually proves

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

Good testing is not “unit vs integration” as a preference. It is choosing the smallest environment that can prove the property without lying about omitted boundaries.

## 1. Pure policy unit test

`security.policy.spec.ts` directly constructs `PolicyService` and plain input objects:

```ts
const policy = new PolicyService();

expect(() => policy.assertTicketAccess(
  caseAgent,
  { ...ticket, queue: 'fraud' },
  'ticket:read',
)).toThrow(ForbiddenException);
```

It proves deterministic permission/scope branches with fast, precise failures. It does not prove guard wiring, HTTP status serialization, database-loaded ticket attributes or the frontend's role mapping.

This is the right level because policy has no infrastructure dependency.

## 2. Guard test with real cryptography

`auth.guard.spec.ts` generates an RSA pair, publishes the public JWK from an in-process HTTP server and signs JWTs with the private key. Calling the actual guard proves:

- JWKS key lookup;
- RS256 signature verification;
- issuer/audience/expiry checks;
- required human claims;
- dedicated service identity behavior;
- `request.user` normalization.

It is still a focused test: it does not start Nest routing or a real identity provider. It is stronger than mocking `jwtVerify`, which would only prove your mock arrangement.

## 3. Nest E2E boundary test

`unauthenticated.e2e-spec.ts` compiles `AppModule`, creates a Fastify-based Nest application and uses `app.inject`:

```ts
const module = await Test.createTestingModule({
  imports: [AppModule],
}).compile();

app = module.createNestApplication(new FastifyAdapter());
app.setGlobalPrefix('v1');
await app.init();
await app.getHttpAdapter().getInstance().ready();

const response = await app.inject({
  method: 'GET',
  url: '/v1/me',
});
expect(response.statusCode).toBe(401);
```

It proves module compilation, route registration, controller guard binding and HTTP status serialization without opening a TCP port.

Important limitation: the test manually sets only the prefix. It does not call production `bootstrap`, so it does not automatically prove Helmet, rate limiting, CORS, request-context registration, empty-JSON parser or the global `ValidationPipe`. A shared app factory or dedicated bootstrap E2E suite would close that gap.

## 4. PostgreSQL integration test

`roles.integration-spec.ts` creates a uniquely named database, installs roles/schema, runs migrations as owner, then connects as app/reporting roles. It proves effective database privileges:

- runtime app can insert/read audit events;
- runtime app cannot update/delete/truncate them;
- runtime app cannot disable trigger or drop table;
- reporting role sees only reporting views;
- owner remains blocked from truncate by the append-only guard;
- startup privilege inspection classifies roles correctly.

A mock `PgService` cannot prove PostgreSQL grants, ownership or trigger behavior. The test is opt-in because it requires external infrastructure and destructive setup scoped to its unique temporary database.

## 5. Test doubles by boundary

Use the narrowest double that preserves the behavior under test:

| Dependency | Useful test double | Do not pretend it proves |
|---|---|---|
| clock | fixed `Clock` provider | real time-zone/scheduler behavior |
| publisher | fake symbol-token publisher | Kafka broker delivery/order |
| database in policy unit | plain ticket object | SQL/locks/constraints |
| remote entitlements | local HTTP test server | production network/identity service |
| object storage | in-memory/fake stream | S3 permissions/checksum transport |

Mocks are tools for isolation, not evidence that the mocked system works.

## 6. Test module override pattern

```ts
const fakeResolver: ContactResolver = {
  resolveEmail: jest.fn().mockResolvedValue('safe@example.test'),
  resolveMobile: jest.fn().mockResolvedValue(null),
};

const module = await Test.createTestingModule({
  imports: [EmailModule],
})
  .overrideProvider(CONTACT_RESOLVER)
  .useValue(fakeResolver)
  .compile();
```

Override the same runtime token consumed by production code. Overriding an interface name or unrelated concrete class has no effect.

## 7. Testing transactional atomicity

For “business write and audit are atomic,” an honest integration test should:

1. arrange valid identity/resource state;
2. trigger the service/HTTP operation;
3. assert both business and audit rows after commit;
4. inject or create an audit failure inside the same transaction;
5. assert neither business nor audit row committed;
6. verify all writes used the callback's `PoolClient`.

A unit test that expects `audit.write` to have been called does not prove rollback or same-connection use.

## 8. Concurrency tests need synchronization

For an optimistic update/claim/idempotency race:

- use a real database;
- arrange one shared starting version/key;
- start two clients from a barrier so requests overlap;
- assert exactly one commit or disjoint claims according to contract;
- assert the loser gets the documented 409/replay behavior;
- verify final rows and audit/outbox count.

Running two promises without controlling overlap can pass without ever creating a race.

## 9. Cleanup and test process lifecycle

- close Nest apps in `afterAll` so provider destroy hooks run;
- close HTTP servers, database pools, Redis/Kafka/storage clients;
- use unique resource names and explicit teardown;
- disable workers unless the test targets them;
- restore process environment between tests;
- avoid relying on test execution order;
- never point destructive integration setup at a shared production-like database.

## 10. Coverage by guarantee

Prefer a guarantee matrix over a line percentage:

| Guarantee | Best evidence |
|---|---|
| role lacks permission | policy unit |
| malformed request becomes 400 | HTTP E2E with production pipe |
| missing token becomes 401 | HTTP E2E |
| JWT signature/claims verified | focused guard + real signed token |
| unique constraint handles race | PostgreSQL integration |
| audit write rolls back mutation | PostgreSQL integration |
| React displays stale conflict | component/UI test |
| full browser OIDC redirect | browser/system test |

One feature usually needs several small proofs rather than one giant test.
