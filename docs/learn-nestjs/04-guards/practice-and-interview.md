# Lesson 4 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Classify the decision

| Question | Authentication guard or service policy? |
|---|---|
| Is the signature trusted? | guard |
| Was the token issued for this API/client? | guard |
| Is the user allowed to update tickets generally? | policy, using normalized identity |
| Is this ticket in one of the user's queues? | service policy after loading ticket |
| Is the user the same person who requested approval? | service policy/maker-checker |
| Is the customer the owner of this portal request? | portal service ownership check |

If a decision needs current resource data, a pure token guard does not have enough information.

## 2. Threat drill

Explain why each approach is unsafe:

1. `JSON.parse(base64Payload)` without signature verification: an attacker can forge every claim.
2. Accepting `role` in the request body: validation checks format, not truth.
3. Allowing any JWT algorithm: creates algorithm-confusion/downgrade risk.
4. Checking only expiry: ignores signature, issuer, audience and intended client.
5. Trusting a hidden React route: callers can invoke the API directly.
6. Logging the bearer token on failure: turns logs into reusable credentials.

## 3. Failure-order drill

Predict the result:

| Situation | First meaningful response |
|---|---|
| no `Authorization` header | 401 missing token |
| valid signature, wrong audience | uniform 401 invalid/expired |
| valid human token, no organizational claims | uniform 401 |
| valid identity, permission absent | 403 from policy |
| permission present, ticket outside scope | 403 or deliberate hidden 404 according to use case |
| sensitive export with old authentication | structured 403 `step_up_required` |

## 4. Interview answer at three depths

### 30 seconds

> A Nest guard authenticates each protected request. It extracts the bearer token, verifies signature, issuer, audience and an asymmetric algorithm allow-list against JWKS, optionally checks revocation and current entitlements, then writes a normalized `UserContext` to the Fastify request. Services use that identity with current resource data for authorization.

### Two minutes

> `AuthGuard` is exported by `AuthModule` and attached at controller level. It uses `ExecutionContext` to get the Fastify request, requires the Bearer scheme, verifies with `jose.jwtVerify` and a remote JWK set, then checks allowed clients and optional token introspection. Entitlement overrides can refresh roles and organizational scope. `toUserContext` allow-lists roles and requires scope claims for human identities, while known machine roles are marked as service identities. The guard also records token assurance fields in request-local audit context and sets a bounded or generated correlation id. It does not authorize a specific ticket; the service loads that ticket and asks `PolicyService` using queue, branch, entity and sensitivity.

### Code-level follow-up

Write the skeleton:

```ts
async canActivate(ctx: ExecutionContext): Promise<boolean> {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

  const { payload } = await jwtVerify(header.slice(7), jwks, {
    issuer,
    audience,
    algorithms: ['RS256'],
  });
  request.user = normalize(payload);
  return true;
}
```

Then explicitly say production code also handles allowed client, revocation, entitlements, claim allow-listing and correlation/audit context.

## 5. Follow-up questions

1. **401 vs 403?** 401 means usable identity was not established; 403 means authenticated identity is insufficient for the requested action.
2. **Why normalize claims?** To give business code one small stable contract and discard unknown/untrusted vocabulary.
3. **Why not load tickets in the guard?** It couples authentication to one domain, duplicates service policy and complicates non-HTTP callers.
4. **What is JWKS rotation?** The IdP publishes current public keys; `kid` selects one and the client can refresh/cache the set as keys rotate.
5. **Why step-up after normal authentication?** Some actions require fresher or stronger authentication than ordinary browsing.
6. **Can a guard return `false`?** Yes; Nest treats it as forbidden. Throwing explicit exceptions gives intentional status/message semantics.

## 6. Debugging checklist for unexpected 401

1. Confirm exact header scheme and token presence without printing the token.
2. Check configured issuer, audience and JWKS URI.
3. Decode only for diagnosis; verify `iss`, `aud`, `exp`, `nbf`, `kid`, `alg`, `azp`.
4. Check identity-provider key rotation/cache/network status.
5. Inspect introspection/entitlement availability and fail-open/closed settings.
6. Confirm required role and organizational claims exist.
7. Reproduce with the signed-token unit test rather than bypassing verification.

## 7. Hands-on exercise

Design a guard for a machine webhook. Decide:

- bearer JWT, mTLS or HMAC;
- replay prevention;
- issuer/audience/client checks;
- normalized service identity;
- which request field receives it;
- what remains a service authorization decision;
- how refusal is audited without storing secrets.

## 8. Self-assessment

You are interview-ready when you can walk from browser token acquisition to `request.user`, name every verification step, separate 401 from 403, and explain why a valid token alone never proves resource access.
