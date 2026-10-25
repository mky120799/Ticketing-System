# Authentication profile and `/me`

`GET /v1/me` tells the frontend how the API normalized the authenticated identity. It is a display/bootstrap endpoint, not a reusable authorization decision.

## Why the controller lives in `DirectoryModule`

[`ProfileController`](../../../apps/api/src/auth/profile.controller.ts) uses `AuthGuard`, then calls `DirectoryService.record(request.user)` before returning `request.user`. It is registered by [`DirectoryModule`](../../../apps/api/src/directory/directory.module.ts), not `AuthModule`, because Directory imports Auth and the controller needs both providers. Registering it in Auth would create an undesirable circular dependency.

The response includes subject, allowlisted roles, branch, queues, department, legal entity, country and presentation claims. It never returns the raw JWT, signing claims, introspection credentials or provider response.

## Request path

```text
SessionProvider has OIDC User
  -> getCurrentUser(user)
  -> GET /v1/me with access-token Bearer header
  -> AuthGuard verifies token and creates UserContext
  -> ProfileController.current
  -> DirectoryService.record (best-effort human display refresh)
  -> return normalized UserContext
```

Directory recording skips machine identities and catches database failures, because an optional display-name refresh must not prevent an otherwise valid staff sign-in.

## Frontend use

[`SessionProvider`](../../../apps/web/src/session/session-provider.tsx) loads `/me` only when an unexpired OIDC user exists. The response supplies `roles`, `profile` and `can(capability)` inputs. While the query is pending, protected routes show a loader; if it fails, the profile error screen explains that the account may lack required claims.

The `/me` query uses an infinite stale time for the current frontend session. This means central entitlement changes can be enforced immediately by the API guard on later requests while navigation may remain visually stale until re-login/refresh. That is safe because frontend capabilities do not authorize anything, but a future improvement could invalidate `/me` on token renewal or entitlement-version change for faster UX convergence.

## Important distinction

The API does not accept a profile returned earlier by `/me`. Every subsequent request sends the access token again, and `AuthGuard` rebuilds `UserContext`, including current introspection/entitlement checks. A user cannot edit React context or `/me` JSON to gain backend permission.

## Tests and interview answer

Test missing/invalid token, normalized role/scope response, service-identity skip, human directory upsert and non-fatal directory failure. Frontend tests should cover pending, profile failure and capability/home-route selection.

> After OIDC login, the console calls `/me` to obtain the API's typed view of roles and organizational scope. The guarded controller also refreshes the staff display directory. That profile drives navigation only; it is not cached proof for the backend. Every later request presents the bearer token and rebuilds the current `UserContext`, so editing frontend state cannot grant access.
