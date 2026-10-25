# Authentication testing

Authentication tests must prove cryptography and Nest wiring, not only call a controller with a fabricated `request.user`.

## Guard tests

[`auth.guard.spec.ts`](../../../apps/api/test/auth.guard.spec.ts) generates an RSA key pair, serves its public key as JWKS and signs real tokens. Cases should cover:

- valid issuer/audience/signature and complete human claims;
- missing, malformed and expired bearer tokens;
- unknown key/bad signature and wrong issuer/audience;
- rejected symmetric/unlisted algorithm;
- missing subject, role or required organizational claims;
- role allowlisting and invalid queue claim values;
- accepted narrow service identity;
- bounded/generated correlation id and audit-context fields.

This catches errors that a mocked decoder cannot, including verifying an ID token or accepting the wrong audience.

## Hardening tests

[`auth-hardening.spec.ts`](../../../apps/api/test/auth-hardening.spec.ts) covers allowed client claims, inactive introspection, hash-keyed caching, provider timeout/error behavior, fail-open switches, entitlement override/fallback, missing entitlement record and step-up combinations.

For step-up, test recent/old/missing `auth_time`, accepted/rejected/missing `acr`, service-identity exemption and the exact structured `step_up_required` code expected by the frontend.

## Boundary and configuration tests

[`unauthenticated.e2e-spec.ts`](../../../apps/api/test/unauthenticated.e2e-spec.ts) proves protected HTTP endpoints return `401` through the assembled Nest application. Portal integration tests prove staff/customer token separation. [`production-safety.spec.ts`](../../../apps/api/test/production-safety.spec.ts) proves unsafe production configuration is rejected before listen.

Frontend tests should cover callback-once behavior under React StrictMode, expired stored sessions, safe return paths, silent-renew updates, 401 sign-out and step-up banner/reauthentication. Compile-time checks ensure `/me` and session types remain aligned.

## Interview answer

> I test authentication with generated asymmetric keys and real signed JWTs against a temporary JWKS, so issuer, audience, expiry, signature and algorithm behavior are exercised. Separate tests fake introspection and entitlement servers to prove timeout and fail-closed policy. E2E tests call protected routes without valid credentials, and portal tests prove issuer separation. I do not count a unit test that manually sets `request.user` as authentication coverage.
