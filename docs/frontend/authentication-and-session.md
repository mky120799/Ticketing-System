# Frontend authentication and session

The staff console uses OpenID Connect Authorization Code with PKCE through `oidc-client-ts`. The identity provider handles credentials; the browser receives tokens after exchanging a one-time authorization code, and the API verifies the access token independently.

## `auth.ts` configuration

[`auth.ts`](../../apps/web/src/auth.ts) requires runtime authority/client id and creates one `UserManager` with:

- redirect and post-logout URLs at the current site origin;
- `response_type: code` and `openid profile` scopes;
- `sessionStorage` user store, so tokens disappear with the tab and are not shared across tabs;
- automatic silent renewal and provider-session monitoring.

Modern OIDC clients generate a code verifier/challenge for PKCE. The authorization response code is useless without the verifier retained by the initiating client. The console never collects or sends a password to this API.

`signIn` stores the current same-site route in OIDC state. `safeReturnPath` accepts only a path beginning with one `/` and rejects `//...`, preventing a protocol-relative open redirect. `reauthenticate` sets `max_age: 0` for step-up while retaining return state.

`completeSignIn` caches its promise because React StrictMode can run the initialization effect twice in development, while the authorization code can only be redeemed once.

## `SessionProvider` state machine

[`session-provider.tsx`](../../apps/web/src/session/session-provider.tsx) exposes:

```ts
{
  user, ready, profile, roles, can,
  error, stepUpRequired, dismissStepUp
}
```

Initialization:

1. Detect `?code=` callback.
2. Complete redirect or load stored user.
3. Discard an expired stored user.
4. Restore validated return path after callback.
5. Mark session discovery ready even when sign-in failed, allowing the login page to render its error.
6. When a user exists, React Query calls `/me` for API-normalized profile/scope.

The provider subscribes to `userManager` events. A renewed token replaces `user`, causing authenticated consumers/live stream to use the new access token. Access-token expiry triggers provider sign-out. The API client dispatches `step-up-required`; provider turns that into shared banner state.

## `/me` and capabilities

The `/me` query key is global for the current session and uses `staleTime: Infinity`. Its roles feed [`roles.ts`](../../apps/web/src/session/roles.ts), which maps to coarse capabilities such as read cases, work ticket, supervise, audit or administer.

This profile is UI state, not backend proof. Every API call still carries the access token, and `AuthGuard` can apply current introspection/entitlements. A revoked queue may therefore cause an API 403 while old navigation remains visible until profile refresh—safe but potentially confusing. Invalidate `/me` on token renewal/subject change if faster entitlement UX is required.

The query cache should be explicitly cleared when subject changes or logout begins. A full IdP redirect/reload often clears in-memory cache, but same-page account switching must not expose the previous user's cached tickets.

## API authentication

`api.ts` sends only `Authorization: Bearer ${user.access_token}`. It must not send the ID token: the API audience and authorization claims belong to the access token. Tokens never appear in URL, application logs, React component props beyond the session user or SSE query strings.

On `401`, the client starts sign-out rather than repeatedly refreshing/retrying a credential the API rejected. Normal query retry excludes all 4xx.

## Step-up sequence

```text
sensitive mutation
  -> API PolicyService.assertStepUp
  -> 403 { code: 'step_up_required' }
  -> api.ts dispatches browser event
  -> SessionProvider sets stepUpRequired
  -> StepUpBanner asks user to reauthenticate
  -> OIDC redirect with max_age: 0
  -> return to original route with fresh auth_time/acr
  -> user deliberately retries action
```

The client does not automatically replay the sensitive mutation after login; doing so could duplicate actions or violate user intent. The user retries from refreshed state.

## Failure and security cases

- Callback exchange fails: generic login error, no partial profile.
- Stored token expired: treated as signed out.
- Silent renewal succeeds: user/live connection updates.
- Renewal fails and token expires: provider logout.
- `/me` lacks accepted claims: profile error screen; protected routes not rendered.
- Edited roles in React DevTools: may reveal a button locally, but API remains 403.
- Malicious return state: `safeReturnPath` falls back to `/`.
- XSS remains dangerous because JavaScript can access sessionStorage; CSP, dependency hygiene and output escaping remain required.

## Tests and interview answer

Test callback once under StrictMode, valid/invalid return state, expired storage, renewal event, expiry event, `/me` pending/failure, subject cache isolation, 401 sign-out and step-up banner/redirect.

> The console uses OIDC Authorization Code with PKCE and sessionStorage. `auth.ts` owns redirects and safe return state; `SessionProvider` resumes/completes login, listens for renewal/expiry and loads `/me`; `api.ts` sends the access token in a bearer header. A structured step-up 403 opens a fresh-login banner without auto-replaying the command. Roles only shape UI—each request is independently verified and authorized by Nest.
