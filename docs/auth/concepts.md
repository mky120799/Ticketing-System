# Auth concepts and glossary

Every term below is used somewhere in the auth code. Each entry gives the **technical term**, then a **plain-language meaning**, often an **analogy**, and **where it appears in our code**.

[Back to Auth index](README.md)

---

## 1. Identity protocols

### OAuth 2.0
**Technical:** An authorization framework that lets an application obtain an *access token* to call an API on a user's behalf, without ever seeing the user's password.
**Plain:** A standard way of saying "this app may call that API for this person" by handing over a temporary pass instead of the person's password.
**Analogy:** A hotel key card. Reception (the identity provider) checks your passport once and gives you a card that opens only certain doors for a limited time.

### OpenID Connect (OIDC)
**Technical:** An identity layer on top of OAuth 2.0. It adds an *ID token* that says who logged in, a discovery document, and a JWKS endpoint for public keys.
**Plain:** OAuth tells the API "this app may act". OIDC adds "and this is who the person is".
**In our code:** the browser uses the `oidc-client-ts` library in [apps/web/src/auth.ts](../../apps/web/src/auth.ts#L12-L20). The bank's identity provider (Keycloak locally) is the OIDC server.

### Identity provider (IdP)
**Technical:** The server that authenticates users and issues tokens (Keycloak, Microsoft Entra ID, Okta, Ping).
**Plain:** The bank's central login system. Our platform never stores passwords; it trusts the IdP.
**In our code:** configured through `OIDC_ISSUER` / `OIDC_JWKS_URI` on the API and `oidcAuthority` on the web app ([config.ts](../../apps/web/src/config.ts)). Local realm files live in `infra/keycloak/`.

### Authorization Code flow
**Technical:** The OAuth flow in which the browser is redirected to the IdP, the user logs in there, and the IdP redirects back with a short-lived one-time *code*. The app exchanges the code for tokens.
**Plain:** Instead of getting the key card directly in the URL, you get a claim ticket that you swap for the card at a counter.
**Why it matters:** tokens never travel in the browser address bar.

### PKCE (Proof Key for Code Exchange, pronounced "pixy")
**Technical:** The client generates a random `code_verifier`, sends only its SHA-256 hash (`code_challenge`) in the login redirect, and must present the original verifier when exchanging the code.
**Plain:** A secret handshake. Even if someone steals the claim ticket (the code), they cannot swap it without the secret only our browser tab knows.
**In our code:** `oidc-client-ts` generates the verifier automatically because `response_type: 'code'` is set ([auth.ts#L16](../../apps/web/src/auth.ts#L16)).

### Redirect URI / `state` / `nonce`
**Technical:** `redirect_uri` is where the IdP sends the browser back. `state` is an opaque value round-tripped to prevent CSRF on the callback, and can carry app data. `nonce` binds the ID token to this login attempt.
**Plain:** `state` is a "this reply belongs to my question" stamp; we also use it to remember which page the user wanted.
**In our code:** the wanted page travels as `state.returnTo` ([auth.ts#L36](../../apps/web/src/auth.ts#L36)) and is validated by `safeReturnPath` ([auth.ts#L31-L34](../../apps/web/src/auth.ts#L31-L34)).

### Silent renew
**Technical:** The client obtains a fresh access token before expiry without user interaction (iframe or refresh token).
**Plain:** The key card is quietly re-issued before it stops working, so the user is not kicked out mid-task.
**In our code:** `automaticSilentRenew: true` ([auth.ts#L19](../../apps/web/src/auth.ts#L19)); the new user object is picked up by `addUserLoaded` in [session-provider.tsx#L67-L70](../../apps/web/src/session/session-provider.tsx#L67-L70).

---

## 2. Tokens

### JWT (JSON Web Token)
**Technical:** A compact, URL-safe token: `base64url(header).base64url(payload).base64url(signature)`. The payload holds *claims*.
**Plain:** A sealed envelope with a note inside. Anyone can read the note, but nobody can change it without breaking the seal.
**Important:** *decoding* a JWT is not *verifying* it. Only checking the signature against a trusted key proves it is genuine.

### Access token vs ID token
**Technical:** The **access token** is meant for the API (its `aud` is the API). The **ID token** is meant for the client app, to learn who logged in.
**Plain:** The access token is the door pass; the ID token is the name badge. Show the door pass at the door.
**In our code:** [api.ts#L67](../../apps/web/src/api.ts#L67) sends `user.access_token`, never the ID token.

### Claims we read
| Claim | Meaning | Where we use it |
|---|---|---|
| `iss` (issuer) | Which IdP issued the token | Must equal `OIDC_ISSUER` ([auth.guard.ts#L53-L57](../../apps/api/src/auth/auth.guard.ts#L53-L57)) |
| `aud` (audience) | Who the token is for | Must equal `OIDC_AUDIENCE`, so a token for another API is refused |
| `sub` (subject) | Stable, opaque user ID | `UserContext.subject`; stored in tickets and the audit trail |
| `exp` / `iat` / `nbf` | Expiry / issued-at / not-before | Checked by `jwtVerify`; `exp` also closes the live SSE stream |
| `azp` / `client_id` | Which application asked for the token | Allowed-client check ([token-checks.ts#L9-L14](../../apps/api/src/auth/token-checks.ts#L9-L14)) |
| `jti` | Unique token ID | Copied into audit metadata as `ctx_jti` |
| `auth_time` | When the user actually typed their credentials | Step-up "was the login recent?" |
| `acr` | Authentication Context Class Reference: how strongly they logged in (e.g. MFA level) | Step-up "was the login strong?" |
| `roles` / `realm_access.roles` | Application roles | Filtered to known roles ([auth.guard.ts#L87-L96](../../apps/api/src/auth/auth.guard.ts#L87-L96)) |
| `branch`, `queues`, `department`, `legal_entity`, `country` | Bank-specific organisational scope | Become `UserContext` scope fields |
| `name`, `preferred_username`, `email` | Display data | Directory display only, never for access |

### JWS signature algorithms (RS256, ES256, PS256)
**Technical:** RS256 = RSA + SHA-256; PS256 = RSA-PSS + SHA-256; ES256 = ECDSA P-256 + SHA-256. All are **asymmetric**: the IdP signs with a private key, everyone verifies with the public key.
**Plain:** Only the bank's IdP has the stamp; everyone else just has a photo of the stamp to compare against.
**Why an allow-list:** the classic "algorithm confusion" attack sends a token with `alg: none` or `alg: HS256` (symmetric) hoping the server accepts it. We pass `algorithms: ['RS256', 'ES256', 'PS256']` ([auth.guard.ts#L56](../../apps/api/src/auth/auth.guard.ts#L56)), so anything else fails. The test [auth-hardening.spec.ts#L29](../../apps/api/test/auth-hardening.spec.ts#L29) proves it.

### JWKS (JSON Web Key Set) and `kid`
**Technical:** A JSON document at a well-known URL listing the IdP's public keys. Each key has a `kid` (key ID); the JWT header names which `kid` signed it.
**Plain:** The IdP publishes a public list of "stamp photos". The token says "I was stamped with stamp #7", and the API looks up photo #7.
**Key rotation:** when the IdP rotates keys, it publishes the new key; `createRemoteJWKSet` fetches and caches it automatically.
**In our code:** [auth.guard.ts#L41-L43](../../apps/api/src/auth/auth.guard.ts#L41-L43).

### Bearer token
**Technical:** An HTTP `Authorization: Bearer <token>` header. Whoever *bears* the token is treated as its owner.
**Plain:** Like cash: whoever holds it can spend it. That is why it must never go in a URL, a log or local storage shared across tabs.

### Token introspection (RFC 7662)
**Technical:** An endpoint where a resource server asks the IdP "is this token still active?".
**Plain:** Phoning the bank to ask "is this card still valid, or was it cancelled after it was issued?".
**Why:** a JWT is self-contained, so it stays valid until `exp` even if the user is disabled. Introspection closes that gap. See [token-hardening.md](token-hardening.md#2-revocation-through-introspection).

---

## 3. Authorization models

### RBAC (role-based access control)
**Technical:** Permissions are attached to roles, and users get roles.
**Plain:** "Supervisors may approve" is a rule about the *job title*, not the person.
**In our code:** the `PERMISSIONS` map in [policy.service.ts#L8-L13](../../apps/api/src/auth/policy.service.ts#L8-L13).

### ABAC (attribute-based access control)
**Technical:** Decisions use attributes of the user, the resource and the context (entity, country, queue, branch, owner, sensitivity).
**Plain:** "A supervisor may approve, **but only for tickets in their own queues and country**."
**In our code:** `assertTicketAccess` in [policy.service.ts#L22-L32](../../apps/api/src/auth/policy.service.ts#L22-L32). We use **RBAC for the action plus ABAC for the row**.

### Default deny / least privilege
**Plain:** If nothing explicitly says yes, the answer is no. A role missing from the map gets no permissions; an unknown role from the token is thrown away.

### Separation of duties / maker-checker (four-eyes principle)
**Technical:** The person who initiates a sensitive action may not approve it.
**Plain:** You cannot sign off your own expense claim.
**In our code:** `assertMakerChecker` ([policy.service.ts#L21](../../apps/api/src/auth/policy.service.ts#L21)), called in `decideApproval` ([tickets.service.ts#L333](../../apps/api/src/tickets/tickets.service.ts#L333)).

### Step-up authentication
**Technical:** Requiring a fresher or stronger authentication (recent `auth_time` or a higher `acr`) for a specific sensitive action, even though the session is valid.
**Plain:** You are already inside the bank, but to open the safe-deposit box you must show your ID again.
**In our code:** [token-checks.ts#L81-L88](../../apps/api/src/auth/token-checks.ts#L81-L88); the browser reacts in [step-up-banner.tsx](../../apps/web/src/layout/step-up-banner.tsx).

### Service identity (machine-to-machine)
**Plain:** A robot account (scanner, intake gateway, email delivery) with exactly one narrow permission and no human scope.
**In our code:** `SERVICE_ROLES` ([auth.guard.ts#L30-L35](../../apps/api/src/auth/auth.guard.ts#L30-L35)); in-process workers build a typed `UserContext` with `serviceIdentity: true`, e.g. [attachment-scan.worker.ts#L8](../../apps/api/src/tickets/attachment-scan.worker.ts#L8).

### Capability (UI) vs permission (API)
**Plain:** A *capability* in the React app decides which buttons to **show**. A *permission* in the API decides what is **allowed**. Hiding a button is tidiness, never security.
**In our code:** capabilities in [roles.ts](../../apps/web/src/session/roles.ts#L12-L23); permissions in [policy.service.ts](../../apps/api/src/auth/policy.service.ts#L5).

---

## 4. HTTP outcomes

| Status | Meaning here | Typical cause |
|---|---|---|
| **401 Unauthorized** | "I don't know who you are" (authentication failed) | Missing, malformed, expired, revoked or wrongly-issued token |
| **403 Forbidden** | "I know who you are, but no" (authorization failed) | Wrong role, ticket outside scope, restricted ticket, self-approval |
| **403 + `code: step_up_required`** | "Yes, but sign in again first" | `auth_time` too old / `acr` too weak |
| **404 Not Found** | Sometimes used deliberately to avoid revealing existence | Portal request owned by another customer; disabled portal |

---

## 5. Browser security terms

### sessionStorage vs localStorage vs cookies
**Plain:** `sessionStorage` is per-tab and cleared when the tab closes; `localStorage` is shared by all tabs and survives restarts; cookies are sent automatically with requests.
**Our choice:** `sessionStorage` ([auth.ts#L18](../../apps/web/src/auth.ts#L18)) limits how long and how widely a token lives. It is still readable by JavaScript, so XSS prevention (CSP, escaping, dependency hygiene) still matters.

### XSS (cross-site scripting)
**Plain:** An attacker gets their JavaScript running on our page, and it can read anything our JavaScript can, including tokens in storage. React escapes text by default and we never inject HTML from data.

### Open redirect
**Plain:** A login link that sends you back to `//evil.example` after login. `safeReturnPath` only accepts paths that start with exactly one `/` ([auth.ts#L31-L34](../../apps/web/src/auth.ts#L31-L34)).

### Correlation ID
**Plain:** A random ID attached to one click (`X-Correlation-Id`) so its trail can be followed through API logs, audit events and outbox messages. It is not a security control. The guard accepts it only if it is a string of at most 128 characters ([auth.guard.ts#L144-L148](../../apps/api/src/auth/auth.guard.ts#L144-L148)).

---

## 6. NestJS pieces involved

| Nest term | Plain meaning | Our example |
|---|---|---|
| Guard (`CanActivate`) | Code that runs before a controller and returns true/false (or throws) | [AuthGuard](../../apps/api/src/auth/auth.guard.ts#L37-L79) |
| `@UseGuards(AuthGuard)` | Attach the guard to a controller | [tickets.controller.ts#L40](../../apps/api/src/tickets/tickets.controller.ts#L40) |
| `ExecutionContext` | Gives the guard access to the raw request | `context.switchToHttp().getRequest()` |
| Module augmentation | Teach TypeScript that `request.user` exists | [user-context.ts#L23](../../apps/api/src/auth/user-context.ts#L23) |
| Global interceptor (`APP_INTERCEPTOR`) | Wraps every handler | Denied-access audit ([app.module.ts#L27](../../apps/api/src/app.module.ts#L27)) |

Deeper framework explanation: [Learn NestJS → Guards](../learn-nestjs/04-guards/README.md).
