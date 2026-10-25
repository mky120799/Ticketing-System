# Authentication module

Authentication answers: “Who is this caller?” Authorization is a separate decision documented in [Authorization](../authorization.md). The browser and API participate in one OIDC flow, but the API remains the final trust boundary.

## Code map

| Layer | Files | Responsibility |
|---|---|---|
| Browser login | [auth.ts](../../../apps/web/src/auth.ts), [login-page.tsx](../../../apps/web/src/layout/login-page.tsx) | Authorization Code + PKCE redirect; the UI never receives a password |
| Browser session | [session-provider.tsx](../../../apps/web/src/session/session-provider.tsx) | Stores the OIDC user, loads `/me`, renews tokens, handles expiry and step-up |
| Browser API calls | [api.ts](../../../apps/web/src/api.ts) | Sends the access token as a Bearer header and correlation id |
| Staff guard | [auth.guard.ts](../../../apps/api/src/auth/auth.guard.ts) | Verifies signature, issuer, audience, algorithm, client, revocation and entitlements |
| Normalized identity | [user-context.ts](../../../apps/api/src/auth/user-context.ts) | Defines the trusted actor/scope object used by services |
| Profile bootstrap | [profile.controller.ts](../../../apps/api/src/auth/profile.controller.ts) | Returns `/me` and refreshes the staff display directory |
| Token hardening | [token-checks.ts](../../../apps/api/src/auth/token-checks.ts) | Introspection, entitlement lookup and step-up decisions |
| Customer guard | [portal-auth.guard.ts](../../../apps/api/src/portal/portal-auth.guard.ts) | Separate issuer/audience/keys for customer identities |

## Request trace

```text
login-page -> OIDC provider -> auth.ts callback -> session-provider
  -> GET /v1/me -> AuthGuard -> UserContext
  -> api.ts adds Authorization: Bearer <token>
  -> protected controller -> service policy
```

`/me` is not used as the API's security proof. It loads the API's normalized view of the already authenticated identity and records the person's display information in the directory.

## Interview answer

“The frontend uses OIDC Authorization Code with PKCE and never handles a password. It keeps the access token in the OIDC client session, sends it only as a Bearer header, and calls `/me` to display the API's roles and organizational scope. On the backend, `AuthGuard` verifies the JWT against the issuer's JWKS with an explicit algorithm allow-list, validates issuer/audience/expiry, optionally checks revocation and central entitlements, then builds `request.user`. Business authorization happens later in `PolicyService` using that context and the resource.”

Continue with [frontend authentication and session](../../frontend/authentication-and-session.md), [backend authentication](backend.md), [`/me` profile](profile-and-me.md), [token hardening](hardening.md), and [authentication testing](testing.md).

## Study this module in order

1. [Staff authentication flow](../../flows/staff-authentication.md) for the browser-to-API sequence.
2. [Frontend authentication and session](../../frontend/authentication-and-session.md) for PKCE, callback, storage, renewal and errors.
3. [Backend code walkthrough](backend.md) for `AuthGuard.canActivate` and claim normalization.
4. [`/me` and profile](profile-and-me.md) for directory refresh and presentation identity.
5. [Hardening](hardening.md) for algorithm/client/revocation/entitlement/step-up decisions.
6. [Testing](testing.md) for signed-token, JWKS and refusal evidence.
7. [Authorization](../authorization.md) for what happens after identity is established.

## Trust-boundary checklist

| Question | Implemented boundary |
|---|---|
| Who authenticates the person? | external OIDC provider; browser never handles password |
| Who verifies the access token? | API `AuthGuard` on every protected request |
| Where are public keys obtained? | configured JWKS endpoint, selected by token `kid` |
| What token properties are enforced? | signature, issuer, audience, algorithm allow-list and time claims |
| How is app/client intent constrained? | optional `azp`/`client_id` allow-list |
| How can revocation apply before expiry? | optional introspection, cached for bounded time |
| How can role/scope change before next login? | optional entitlement lookup, cached for bounded time |
| What reaches business services? | allow-listed `UserContext`, never raw token as policy input |
| Where is resource access decided? | `PolicyService` in the service using current resource attributes |
| What does the frontend role map do? | presentation only; it is not a server permission |

## Code-level explanation checklist

Be able to name these exact operations:

```text
UserManager.signinRedirect
-> authorization code + PKCE
-> completeSignIn / signinCallback
-> sessionStorage OIDC User
-> api.ts Authorization header
-> AuthGuard.canActivate(ExecutionContext)
-> jwtVerify(remoteJWKSet, issuer, audience, algorithms)
-> assertAllowedClient + assertTokenActive + lookupEntitlements
-> toUserContext
-> request.user + request-local audit facts
-> controller/service PolicyService
```

Then state failure semantics: malformed or unverifiable identity is 401; valid identity without operation/resource permission is 403; a sensitive action can return coded `step_up_required` 403 without ending the whole session.

## Known operational trade-offs

- Introspection and entitlement results are cached, so changes apply within a configured window rather than instantaneously.
- Explicit fail-open switches improve availability but weaken real-time revocation/entitlement assurance; defaults are fail-closed.
- Browser session storage reduces persistence/sharing but remains readable by JavaScript, so XSS prevention is still critical.
- Handler interceptors do not observe guard 401s; authentication-failure telemetry must live at the guard/edge without storing tokens.
- Real OIDC callback, MFA and logout behavior require deployed browser/IdP testing in addition to unit/E2E tests.
