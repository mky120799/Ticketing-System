# Authentication: backend code walkthrough

The staff backend authentication entry point is [`AuthGuard`](../../../apps/api/src/auth/auth.guard.ts). It validates a bearer access token and builds the only identity shape used by controllers/services: `request.user: UserContext`.

## `canActivate` execution order

1. Read `Authorization` and require the exact `Bearer ` scheme. Missing/malformed credentials produce `401` before controller code runs.
2. Refuse to authenticate if issuer/audience configuration is missing.
3. Call `jose.jwtVerify` with the remote JWKS, expected issuer, audience and the explicit asymmetric allowlist `RS256`, `ES256`, `PS256`.
4. Call `assertAllowedClient` to check `azp`/`client_id` when configured.
5. Call optional token introspection to catch revocation before JWT expiry.
6. Call optional entitlement lookup for current centrally managed roles/scope.
7. Convert claims plus overrides to `UserContext`.
8. Copy token id, ACR and authentication time into request audit context.
9. Accept an inbound correlation id only when it is a string no longer than 128 characters; otherwise create a UUID.
10. Return `true`, allowing Nest to invoke the route handler.

Any validation/conversion exception is collapsed to `Invalid or expired access token`. The client must not learn whether signature, audience, client or entitlement failed.

## Signature and claims

`createRemoteJWKSet` retrieves/caches the issuer's public keys and supports key rotation by `kid`. `jwtVerify` performs signature verification plus registered claim checks such as issuer, audience and expiry. The algorithm allowlist prevents accepting a token using an unexpected symmetric or `none` algorithm.

JWT decoding alone is not authentication. The critical operation is verifying the signature against trusted keys and binding the token to the configured issuer/audience/client.

## `toUserContext`

The guard requires string `sub`, then takes roles from entitlement override, token `roles`, or realm roles. It filters them against the closed `CaseRole` list. Queue values are similarly filtered to strings.

Human users must have at least one known role plus branch, department, legal entity and country. A recognized service role marks `serviceIdentity` and may omit human organizational claims. Display name, username and email are copied for Directory presentation only.

```ts
interface UserContext {
  subject: string;
  roles: CaseRole[];
  branch: string;
  queues: string[];
  department: string;
  legalEntity: string;
  country: string;
  serviceIdentity?: boolean;
  tokenId?: string;
  tokenExpiresAt?: number;
  authTime?: number;
  acr?: string;
}
```

Controllers pass this context to services; they do not reread untrusted JWT claims. `PolicyService` is responsible for authorization after authentication.

## Staff/customer separation

[`PortalAuthGuard`](../../../apps/api/src/portal/portal-auth.guard.ts) uses separate customer issuer, audience and JWKS settings and writes `request.customer`, not `request.user`. Cryptographic audience/issuer separation means a valid staff token cannot call customer routes and vice versa.

If the optional portal identity configuration is absent, portal routes return not found rather than operating partially configured.

## Frontend-to-guard trace

[`apps/web/src/auth.ts`](../../../apps/web/src/auth.ts) starts Authorization Code with PKCE. After the IdP callback, `oidc-client-ts` exchanges the one-time code and stores the resulting session in `sessionStorage`. [`api.ts`](../../../apps/web/src/api.ts) adds `Authorization: Bearer <access_token>`; the access token, not the ID token, is what `AuthGuard` accepts.

`GET /me` returns the backend's normalized identity for UI decisions, but `/me` is not reused as proof on later requests. Every protected request presents and revalidates the bearer token.

## Failure map

- `401`: missing token, bad signature, wrong issuer/audience/client, expiry, revoked token, unknown/missing role or required human claims.
- `403`: authentication succeeded, but policy/scope/step-up denied an operation.
- `404` on disabled optional portal surface: configuration deliberately hides it.

## Interview answer

> My Nest guard does more than decode JWTs. It verifies the access-token signature through the issuer JWKS with an asymmetric algorithm allowlist, binds issuer, audience and optionally client, checks revocation/current entitlements, then maps only allowlisted claims into a typed `UserContext`. Human users must have complete organizational scope; machine roles are narrow. Staff and customer tokens use separate guards and issuers. All detailed failures become a generic 401, and services perform authorization separately.
