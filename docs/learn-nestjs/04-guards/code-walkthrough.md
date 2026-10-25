# Lesson 4 code walkthrough: how a bearer token becomes request identity

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This lesson focuses on the Nest guard boundary. For every claim check, OIDC browser flow and policy rule, use the separate [authentication](../../modules/authentication/README.md) and [authorization](../../modules/authorization.md) tracks.

## 1. Where the guard is bound

`TicketsController` has:

```ts
@Controller('tickets')
@UseGuards(AuthGuard)
export class TicketsController {}
```

Before any matching handler runs, Nest calls `AuthGuard.canActivate(context)`. A returned `true` continues. `false` becomes a generic forbidden response; this project throws specific unauthorized exceptions for failed authentication.

`AuthModule` owns and exports the guard:

```ts
@Module({
  providers: [AuthGuard, PolicyService],
  exports: [AuthGuard, PolicyService],
})
export class AuthModule {}
```

Feature modules importing `AuthModule` can use the guard and inject policy.

## 2. Extract the HTTP request from `ExecutionContext`

```ts
const request = context.switchToHttp().getRequest<FastifyRequest>();
const authorization = request.headers.authorization;
```

`ExecutionContext` is Nest's transport-neutral wrapper. `switchToHttp()` says this guard expects an HTTP invocation. In a WebSocket or microservice handler, the adapter-specific context would differ.

The header check is strict:

```ts
if (!authorization?.startsWith('Bearer ')) {
  throw new UnauthorizedException('Missing bearer access token');
}
```

The guard does not accept tokens from the body or query string, where logs, browser history or referrers can expose them.

## 3. Verify, do not decode-and-trust

`jwtVerify` performs cryptographic and registered-claim checks together:

```ts
const { payload } = await jwtVerify(token, this.jwks, {
  issuer: this.issuer,
  audience: this.audience,
  algorithms: ['RS256', 'ES256', 'PS256'],
});
```

The remote JWK set selects a trusted public key. The fixed asymmetric algorithm allow-list prevents an attacker from changing the token to an unexpected signing mode. Issuer prevents a token from another identity domain; audience prevents a token meant for another API.

After signature/claims:

1. `assertAllowedClient(payload)` optionally checks `azp`/`client_id`.
2. `assertTokenActive(token)` optionally introspects current revocation state.
3. `lookupEntitlements(sub)` optionally obtains fresher roles/scope than the token.
4. `toUserContext(payload, override)` normalizes only known roles and claims.

The outer `catch` intentionally returns a uniform `Invalid or expired access token` for verification failures. This reduces detail leaked to unauthenticated callers; tests/logging must provide diagnosis internally without logging tokens.

## 4. Convert claims into a small application contract

The rest of the application does not receive the raw JWT. It receives:

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

Normalization matters:

- unknown roles are filtered rather than becoming accidental permissions;
- human users require branch, department, entity and country scope;
- known machine roles may omit human organizational claims;
- display name/email are explicitly presentation data, never policy authority;
- token id, authentication time and assurance level support evidence and step-up.

The guard stores this object on `request.user`. Fastify declaration merging in `user-context.ts` teaches TypeScript that the field exists; it does not create the field at runtime.

## 5. Correlation and audit context

After identity succeeds, the guard:

```ts
request.correlationId = validHeader ?? crypto.randomUUID();
```

It also enriches the request's `AsyncLocalStorage` audit context with token id, `acr` and authentication time. The Fastify `onRequest` hook already placed IP and user agent there.

This splits context by trust source:

| Fact | Source |
|---|---|
| IP/user agent | server-observed Fastify request |
| subject/roles/scope | verified token or entitlement service |
| token id/auth time/acr | verified token |
| correlation id | bounded caller header or server-generated UUID |

Correlation is trace context, not authorization. A client can suggest it, so it must not be treated as identity.

## 6. Authentication stops before controller and pipes

For a missing/invalid bearer token:

```text
route matched
-> guard throws 401
-> no interceptor for the handler is entered
-> no DTO pipe
-> no controller
-> no service/database work
-> exception layer writes 401
```

This order explains why an invalid protected body plus no token returns 401 rather than validation details.

## 7. Why resource authorization is in a service

The guard can establish who the caller is without loading a ticket. It cannot decide whether that user can update this particular ticket without ticket attributes such as queue, branch, legal entity and sensitivity.

Service pattern:

```ts
const ticket = await loadTicket(client, ticketId);
if (!ticket) throw new NotFoundException('Ticket not found');

this.policy.assertTicketAccess(user, ticket, 'ticket:update');
```

That order also permits deliberate 404 hiding where appropriate. Keeping resource policy in reusable services protects calls from HTTP controllers, workers and integration adapters consistently.

## 8. Staff and customer identities are separated

`PortalAuthGuard` builds a customer context for `request.customer`; it does not reuse staff roles or `request.user`. Separate issuer/audience/client configuration and request fields reduce accidental privilege mixing.

The public upload route uses a capability token instead. Guards are one authentication mechanism, not the definition of all security.

## 9. Frontend handoff

The staff React app obtains an access token through OIDC Authorization Code + PKCE and the API client adds:

```http
Authorization: Bearer <access-token>
```

The browser may decode claims for presentation, but API authorization relies only on server verification. A 401 initiates session recovery/sign-in; a structured `step_up_required` 403 triggers a stronger/recent sign-in; other 403 responses remain authorization failures.

## 10. Boundary limitations to state honestly

- Optional introspection/entitlement lookups have short caches, so revocation/change latency is bounded but not zero.
- Fail-open modes are configurable for external lookups and must be a deliberate risk decision.
- The guard catches verification details and returns a uniform 401, so operational telemetry is essential.
- A valid token is only identity evidence; service policy and current database state still decide access.

Continue with the full [backend authentication walkthrough](../../modules/authentication/backend.md) for configuration, claim sources, revocation and step-up details.
