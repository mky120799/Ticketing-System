# Authentication hardening

JWT signature and expiry validation are the base layer. This module adds client binding, revocation, current entitlements, step-up and startup safety for risks that a self-contained token cannot solve alone.

## Allowed clients

When `AUTH_ALLOWED_CLIENTS` is set, `assertAllowedClient` reads `azp` first and falls back to `client_id`. A token issued by the correct identity provider for an unexpected application is rejected. This narrows confused-deputy/token-substitution risk when one issuer serves many clients.

## Revocation through introspection

With `AUTH_INTROSPECTION_URL`, `assertTokenActive` sends RFC 7662-style form input using a Basic-auth client credential and a three-second timeout. It caches only active/inactive state under `SHA-256(raw token)`—the raw bearer token is never a cache key or log value.

The cache TTL defaults to 30 seconds, defining the maximum expected delay before revocation takes effect. Inactive results are cached too. Provider/network errors fail closed unless `AUTH_INTROSPECTION_FAIL_OPEN=true` is an explicit availability decision.

Tradeoff to explain: local JWT verification is fast/available but cannot see early revocation; introspection shortens revocation latency at the cost of an online dependency, mitigated by a bounded cache.

## Central entitlements

With `ENTITLEMENT_URL`, `lookupEntitlements(subject)` retrieves current roles, queues and organizational scope with a three-second timeout. Values omitted by the entitlement response fall back to token claims; a `404` means the user has no record and is denied.

The 2,000-entry cache defaults to 60 seconds. Failures deny by default; `ENTITLEMENT_FAIL_OPEN=true` falls back to signed token claims. This allows queue removal or role changes to take effect before the next full login while retaining a clear availability/security choice.

## Step-up authentication

Sensitive service methods call `PolicyService.assertStepUp(user, action)`. It is enabled by either:

- `STEP_UP_MAX_AGE_SECONDS`: `auth_time` must be recent; or
- `STEP_UP_ACR_VALUES`: token `acr` must match an accepted authentication strength.

Meeting either configured condition is sufficient. Failure returns a structured 403 body with `code: step_up_required`. [`SessionProvider`](../../../apps/web/src/session/session-provider.tsx) receives a browser event from the API client, shows [`step-up-banner.tsx`](../../../apps/web/src/layout/step-up-banner.tsx), and [`reauthenticate`](../../../apps/web/src/auth.ts) starts OIDC again with `max_age: 0` while preserving a same-origin return path.

Service identities are exempt because they cannot interact with a login prompt; their narrow permission is the compensating boundary.

## Browser controls

Tokens use `sessionStorage`, reducing persistence across browser restarts and avoiding cross-tab sharing. Authorization Code + PKCE keeps passwords out of the console and binds the authorization response to the initiating browser. `safeReturnPath` permits only a single-slash local path, rejecting protocol-relative open redirects such as `//evil.example`.

OIDC renewal replaces the in-memory user; expiry triggers sign-out. API `401` handling must clear/terminate the session instead of repeatedly retrying with the same invalid token.

## Production startup safety

`assertProductionSafety` refuses unsafe production combinations such as development issuers, weak local database settings, missing allowed clients and an unrestricted audit database role. These checks execute before Nest listens, converting security configuration drift into deployment failure.

Secrets belong in deployment secret stores, must not be committed or exposed to frontend runtime config, and need rotation procedures. TLS and secure response headers remain mandatory outside this code layer.

## Interview answer

> I harden JWT authentication with client binding, optional introspection and current entitlement lookup. Introspection keys its short cache by token hash and fails closed by default; entitlement lookup lets removals apply within a minute. Sensitive actions require recent or strong authentication and the React client handles the structured step-up response by starting a fresh OIDC flow. Production safety checks refuse known insecure configuration before the server starts.
