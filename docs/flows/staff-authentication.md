# Flow: staff authentication

This flow connects the React OIDC session to Nest's verified `UserContext`. The browser initiates sign-in and stores tokens for the tab; it never becomes the authority for backend identity or access.

## End-to-end sequence

```text
LoginPage
  -> auth.ts signIn(returnTo)
  -> oidc-client-ts creates state, nonce and PKCE verifier/challenge
  -> browser redirects to the configured identity provider
  -> IdP authenticates user and returns one-time authorization code
  -> completeSignIn() validates callback and exchanges code + verifier
  -> UserManager stores OIDC User in sessionStorage
  -> SessionProvider calls GET /v1/me with access token
  -> AuthGuard verifies JWT/JWKS/issuer/audience/algorithm/client/activity
  -> optional entitlement lookup supplies current role/scope overrides
  -> guard normalizes UserContext and request audit context
  -> ProfileController calls DirectoryService.record
  -> /me returns roles and organizational scope
  -> SessionProvider derives presentation capabilities
  -> router renders the permitted home/screen
```

## 1. Browser starts Authorization Code + PKCE

[`auth.ts`](../../apps/web/src/auth.ts) configures `oidc-client-ts` with `response_type: 'code'`, `openid profile`, the runtime authority/client id and root callback URL. PKCE means the browser creates a one-time verifier and sends only its challenge during authorization; a stolen code cannot be exchanged without that verifier.

The app never receives a password. Password/MFA/device policy belongs to the bank identity provider.

The requested local path travels in OIDC `state`. `safeReturnPath` accepts only a single-leading-slash same-site path and rejects `//host`, preventing an open redirect after login.

## 2. Callback is completed exactly once

React StrictMode can execute effects twice during development, but an authorization code is single-use. `completeSignIn` caches the pending callback promise so the code is not redeemed twice.

The resulting OIDC user is stored through `WebStorageStateStore(sessionStorage)`:

- a tab close removes the browser-side session state;
- tokens are not shared through localStorage across tabs;
- JavaScript can still access the token, so CSP/dependency hygiene and avoiding XSS remain essential;
- the access token is sent in an Authorization header, never a URL.

## 3. SessionProvider establishes application state

[`SessionProvider`](../../apps/web/src/session/session-provider.tsx) handles four cases:

1. callback URL contains `code`: complete sign-in, then replace navigation with safe `returnTo`;
2. ordinary load: recover the current user from session storage;
3. expired user: treat as signed out;
4. valid user: call `/me` to learn the API's normalized identity and scope.

It listens for silent token renewal, access-token expiry and the application's `step-up-required` event. Components consume `useSession`; protected API callers use `useSignedInUser`.

Frontend capabilities are derived from `/me.roles` only to select routes and buttons. They can be stale or manipulated, so they never replace server checks.

## 4. Shared API client sends trusted protocol context

Every protected call through `apps/web/src/api.ts` adds:

```http
Authorization: Bearer <access-token>
X-Correlation-Id: <fresh random uuid>
Content-Type: application/json
```

On 401, the client starts sign-out because the session is no longer usable. On `403` with code `step_up_required`, it raises an event so the shell can offer `reauthenticate(max_age: 0)` and return to the same safe path.

## 5. AuthGuard independently verifies every request

[`AuthGuard`](../../apps/api/src/auth/auth.guard.ts) does not trust browser decoding. It:

1. requires the Bearer scheme;
2. requires configured issuer/audience;
3. verifies signature through remote JWKS;
4. permits only `RS256`, `ES256` or `PS256`;
5. validates issuer, audience and temporal claims through `jwtVerify`;
6. optionally allow-lists the issuing client (`azp`/`client_id`);
7. optionally checks current activity through introspection;
8. optionally loads current entitlement overrides;
9. filters roles to known application roles;
10. requires organizational claims for human users;
11. writes normalized `request.user`, correlation id and token assurance facts.

Unknown roles are discarded. Display name/email are presentation data and never authorization inputs. Known machine roles are marked `serviceIdentity` and have narrow permissions rather than fake human scope.

## 6. `/me` and directory refresh

`ProfileController.current` returns `request.user` and asks `DirectoryService.record` to upsert the human's display identity. The directory write is best-effort: a name-decoration outage must not turn valid authentication into an outage.

Tickets/audit continue to store immutable IdP subject ids. Directory names are resolved later for display and are scoped by legal entity/country.

## 7. Session continuation and expiry

- `automaticSilentRenew` replaces the OIDC user when renewal succeeds.
- access-token expiry starts sign-out if renewal fails.
- each ordinary API request is reverified by the guard.
- the SSE stream is forcibly closed at the token's expiry because an already-open connection would not naturally pass through the guard again.
- entitlement/introspection caches bound—but do not eliminate—the delay before revocation changes take effect.

## Failure map

| Failure | Layer | User-visible behavior |
|---|---|---|
| missing frontend OIDC config | app bootstrap | fail clearly before rendering authenticated app |
| IdP/callback failure | `SessionProvider` | safe sign-in error, no partial session |
| unsafe `returnTo` | `safeReturnPath` | fall back to `/` |
| token absent/malformed/expired/wrong issuer/audience | `AuthGuard` | 401, shared client signs out |
| no known role/required human scope | `AuthGuard` | 401 invalid identity context |
| introspection/entitlement unavailable | token checks | fail closed by default; explicit risk flag may alter behavior |
| authenticated but action forbidden | service policy | 403, session remains valid |
| stronger/recent auth needed | step-up policy | coded 403, reauthentication banner |

## Security boundaries to say explicitly

- OIDC authenticates; application policy authorizes.
- PKCE protects code exchange; it does not prevent XSS from reading in-memory/session tokens.
- sessionStorage is a storage choice, not server-side session validation.
- `/me` reflects server-normalized claims; the browser cannot promote itself by editing React state.
- logout/revocation timing depends on token lifetime plus optional introspection cache.
- staff and customer portal have separate OIDC/guard/request-context boundaries.

## Tests that prove the flow

- generated RSA key + local JWKS tests signature, issuer, audience, expiry and service identity;
- hardening tests algorithm confusion, allowed client, introspection, entitlements and step-up;
- Nest E2E proves `/v1/me` is guarded and returns 401 without usable identity;
- frontend tests should cover callback-once behavior, safe return paths, expiry/sign-out, renewal and step-up event handling;
- browser/system testing is still needed to prove real IdP redirect, cookies/MFA and deployment callback URLs.

## Interview answer

> The React app uses OIDC Authorization Code with PKCE through `oidc-client-ts`; it never handles a password. It stores the OIDC user in tab-scoped session storage, completes the one-time callback once, and calls `/me`. Every API request sends the access token in a Bearer header. `AuthGuard` independently verifies JWKS signature, issuer, audience, algorithm, expiry, optional client/revocation and current entitlements, then normalizes known roles and organization claims into `request.user`. Services combine that identity with current resource data for authorization. Frontend capabilities only choose presentation. A 401 ends the session, while a coded 403 can trigger step-up reauthentication. The SSE connection also closes at token expiry.
