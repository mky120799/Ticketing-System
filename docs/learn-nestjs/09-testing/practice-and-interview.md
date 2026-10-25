# Lesson 9 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Choose the honest test level

| Property | Test level | Why |
|---|---|---|
| maker cannot approve own request | unit | pure policy branch |
| endpoint has guard and returns 401 | E2E | route/module/HTTP boundary matters |
| audit role cannot truncate table | database integration | PostgreSQL privilege semantics matter |
| two workers claim different rows | database concurrency integration | locks/transactions matter |
| React mutation refetches ticket | frontend hook/component test | client cache behavior matters |
| IdP login redirects correctly | browser/system | real browser and IdP protocol matter |

## 2. Critique the test

```ts
expect(audit.write).toHaveBeenCalled();
```

This proves only that a JavaScript mock was invoked. It does not prove the event shape is complete, that it used the same transaction client, that a failure rolls back business state, or that the runtime database role can insert but not alter the event.

Keep the unit assertion if useful, then add integration evidence for the stronger guarantee.

## 3. E2E parity drill

The current unauthenticated E2E test creates `AppModule` directly and adds `/v1`. List what production `main.ts` adds that this setup omits:

- production-safety check;
- Fastify logger redaction/body limit/trust proxy options;
- Helmet;
- rate limiting;
- request `AsyncLocalStorage` hook;
- empty JSON body parser;
- CORS;
- global `ValidationPipe`.

A reusable `createApp()` function used by both `main.ts` and tests would reduce drift.

## 4. Interview answer at three depths

### 30 seconds

> I choose tests by guarantee: pure policies get unit tests, controller/guard/DTO wiring gets Fastify-injected Nest E2E tests, and transactions, locks, constraints and privileges get real PostgreSQL integration tests. I test refusal and concurrency paths, override runtime provider tokens, and state what each test does not prove.

### Two minutes

> Policy tests directly construct `PolicyService` and prove queue, sensitivity, auditor and maker-checker branches. Auth tests use a real generated RSA key and local JWKS endpoint so signature, issuer, audience, expiry and normalized claims are actually verified. E2E tests compile `AppModule` and call `app.inject` to prove route/guard/status behavior, although the current setup does not execute all `main.ts` plugins and global pipes—a parity gap I would address with a shared app factory. Integration tests create a temporary PostgreSQL database and prove role privileges, migrations, triggers and transactional behavior that mocks cannot. Worker claim/concurrency tests need two real clients and synchronized overlap.

### Code-level follow-up

Be ready to write:

```ts
const testingModule = await Test.createTestingModule({
  imports: [FeatureModule],
})
  .overrideProvider(EXTERNAL_ADAPTER)
  .useValue(fakeAdapter)
  .compile();
```

Then explain when importing the full feature is useful and when constructing only the service/providers gives a smaller unit test.

## 5. Follow-up questions

1. **Why not mock PostgreSQL for everything?** Mocks cannot prove SQL syntax, constraints, isolation, locks, grants or rollback.
2. **Why not make every test E2E?** Slow/broad failures reduce diagnostic precision; pure logic is cheaper and clearer in units.
3. **What does `app.inject` avoid?** Opening a network socket while still using the actual Fastify routing pipeline configured on that test app.
4. **How do you test JWTs well?** Sign real short-lived tokens with a generated key and serve matching JWKS; include negative algorithm/issuer/audience/expiry cases.
5. **How do you avoid flaky worker tests?** Call `runOnce`, inject a clock/adapters and reserve timer tests for a narrow lifecycle suite.
6. **What should security tests emphasize?** Refusal, bypass attempts, revoked/stale state and least privilege, not only happy paths.

## 6. Design a feature test matrix

For “rate a resolved ticket” include:

| Test | Proof |
|---|---|
| DTO unit or E2E: rating 0/6 rejected | boundary range |
| policy unit: unauthorized role denied | permission |
| service/integration: open ticket rejected | state rule |
| E2E: missing token 401 | guard binding |
| DB integration: duplicate actor/ticket race | unique constraint |
| DB integration: audit failure rolls back rating | atomic evidence |
| frontend: 409/403 mapped safely | user recovery |

## 7. Hands-on exercise

Write a test plan for outbox delivery that covers:

- enqueue in same transaction as a ticket change;
- two workers claim disjoint rows;
- publisher success marks published;
- failure schedules retry and increments attempt;
- fifth failure dead-letters;
- stale in-flight row is released;
- publish-before-mark crash creates a duplicate and consumer deduplicates.

Label which items are unit, database integration and broker integration.

## 8. Self-assessment

You are ready when every test claim begins with “this proves…” and ends with an honest list of boundaries it replaces or omits.
