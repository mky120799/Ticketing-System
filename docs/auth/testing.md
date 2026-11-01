# Testing auth

Authentication tests must exercise **real cryptography and real Nest wiring**. A test that sets `request.user` by hand proves nothing about authentication.

[Back to Auth index](README.md)

---

## 1. Test map

| Claim to prove | Test | Level | How it proves it |
|---|---|---|---|
| Bad/expired tokens are refused, good ones produce `UserContext` | [auth.guard.spec.ts](../../apps/api/test/auth.guard.spec.ts) | Unit with real crypto | Generates an RSA key pair, serves it as a JWKS from a local HTTP server, signs real JWTs |
| Algorithm confusion is blocked | [auth-hardening.spec.ts#L29-L32](../../apps/api/test/auth-hardening.spec.ts#L29-L32) | Unit | Signs a token with `HS256` claiming `supervisor`; guard rejects |
| Allowed clients | [auth-hardening.spec.ts#L34-L39](../../apps/api/test/auth-hardening.spec.ts#L34-L39) | Unit | Wrong `azp` → 401; **no `azp` at all** → 401; right `azp` → ok |
| Revocation, fail-closed, fail-open switch | [auth-hardening.spec.ts#L41-L47](../../apps/api/test/auth-hardening.spec.ts#L41-L47) | Unit + fake IdP | Fake `/introspect` toggles `active` and can return 500 |
| Live entitlements override token; missing record denies | [auth-hardening.spec.ts#L49-L54](../../apps/api/test/auth-hardening.spec.ts#L49-L54) | Unit + fake service | Fake `/entitlements` returns overrides or 404 |
| Step-up rules | [auth-hardening.spec.ts#L56-L76](../../apps/api/test/auth-hardening.spec.ts#L56-L76) | Unit | Recent vs old `auth_time`, strong `acr`, service exemption, `code: step_up_required` |
| Policy decisions | [security.policy.spec.ts](../../apps/api/test/security.policy.spec.ts) | Pure unit | Queue, sensitivity, auditor read-only, admin has no ticket access, maker-checker |
| Guard is actually wired | [unauthenticated.e2e-spec.ts](../../apps/api/test/unauthenticated.e2e-spec.ts) | E2E (whole `AppModule`) | `GET /v1/me` without/with malformed token → 401 through Fastify `inject` |
| Staff vs customer tokens can't cross | [portal.integration-spec.ts#L33](../../apps/api/test/portal.integration-spec.ts#L33) | Integration | Customer token on staff route and staff token on portal route both fail |
| Production refuses dev identity settings | [production-safety.spec.ts](../../apps/api/test/production-safety.spec.ts) | Unit | Each unsafe setting is listed; the override works |
| Real browser login + deep link | [e2e/tests/staff.spec.ts#L4-L17](../../e2e/tests/staff.spec.ts#L4) | Playwright | Accessible login screen; a deep link survives sign-in |
| Role-based screens | [e2e/tests/staff.spec.ts#L82](../../e2e/tests/staff.spec.ts#L82), [#L105](../../e2e/tests/staff.spec.ts#L105) | Playwright | Admin sees configuration; auditor sees integrity + search |

---

## 2. How the guard test builds a fake IdP

[auth.guard.spec.ts#L15-L31](../../apps/api/test/auth.guard.spec.ts#L15-L31):

```ts
const keys = await generateKeyPair('RS256');
publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
server = createServer((request, response) => {
  if (request.url?.endsWith('/jwks')) { response.end(JSON.stringify({ keys: [publicJwk] })); return; }
  response.statusCode = 404; response.end();
});
process.env.OIDC_ISSUER = baseIssuer; process.env.OIDC_AUDIENCE = audience; process.env.OIDC_JWKS_URI = jwksUri;
```

Then tokens are signed with the private key ([L57-L61](../../apps/api/test/auth.guard.spec.ts#L57-L61)) and passed through a minimal `ExecutionContext` stub ([L62](../../apps/api/test/auth.guard.spec.ts#L62)).

**Plain:** we become a tiny identity provider inside the test. That way the real `jose` verification, the real JWKS fetch and the real claim mapping all run. A mocked decoder would miss bugs like "accepts the ID token" or "ignores audience".

---

## 3. How hardening tests fake external services

[auth-hardening.spec.ts#L13-L19](../../apps/api/test/auth-hardening.spec.ts#L13-L19): one HTTP server answers `/jwks`, `/introspect` (with switchable `active` and a "down" mode) and `/entitlements` (returns an override or 404). Cache TTLs are set to `0` in the tests so every call hits the fake server.

The revocation test reads like a story ([L41-L47](../../apps/api/test/auth-hardening.spec.ts#L41-L47)):

```ts
await expect(run(await token())).resolves.toBeDefined();                 // active → ok
introspectionActive = false; await expect(run(...)).rejects.toBeInstanceOf(UnauthorizedException);   // revoked → 401
introspectionActive = true; introspectionDown = true; await expect(run(...)).rejects...;              // IdP down → 401 (fail closed)
process.env.AUTH_INTROSPECTION_FAIL_OPEN = 'true'; await expect(run(...)).resolves.toBeDefined();     // explicit fail-open → ok
```

---

## 4. How to run

```bash
npm test                                        # unit tests (guard, hardening, policy, safety...)
npm run test:e2e                                # Nest E2E (unauthenticated boundary)
npm run test:integration --workspace=@bank-case/api   # needs a migrated database
cd e2e && npx playwright test                   # browser, needs the docker stack
```

---

## 5. What is not yet covered (and what to add)

| Gap | Suggested test |
|---|---|
| Wrong `iss` / wrong `aud` explicitly | Two more `signToken` variants in `auth.guard.spec.ts` |
| Unknown role filtered out; non-string queue dropped | Token with `roles: ['superadmin','case-agent']`, `queues: ['a', 7]` |
| Human token missing `country` | Expect 401 "claims missing" |
| Correlation ID longer than 128 characters is replaced | Assert `request.correlationId !== header` |
| Introspection cache key is a hash (not the token) | Spy on the cache map |
| Frontend: `completeSignIn` runs once under StrictMode; `safeReturnPath` cases; 401 → sign-out; step-up event → banner | Vitest + React Testing Library around `SessionProvider` |

## 6. Interview answer

> I test authentication with real asymmetric keys: the test spins up a local JWKS server, signs genuine JWTs, and runs the real guard. Hardening tests fake the introspection and entitlement endpoints to prove revocation, fail-closed and override behaviour, and they include an HS256 forgery to prove the algorithm allow-list. A Nest E2E test proves the guard is actually wired on `/v1/me`, and the portal integration test proves staff and customer tokens can't cross. Policy rules are pure unit tests. I never count "I set `request.user` manually" as authentication coverage.

Next: [Interview Q&A](interview-qa.md)
