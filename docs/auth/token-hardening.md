# Token hardening

A verified JWT proves "the IdP issued this to someone, for this API, and it has not expired". Banks need more:

- Was it issued to **our** app?
- Has it been **revoked** since?
- Have the person's **roles changed** since they logged in?
- Did they log in **recently or strongly enough** for this sensitive action?
- Is the server even **configured safely**?

All of this lives in [apps/api/src/auth/token-checks.ts](../../apps/api/src/auth/token-checks.ts) and [apps/api/src/production-safety.ts](../../apps/api/src/production-safety.ts).

[Back to Auth index](README.md) · Terms used here: [concepts](concepts.md)

---

## Summary table

| Control | Env var(s) | Default | Fails | Code |
|---|---|---|---|---|
| Allowed clients | `AUTH_ALLOWED_CLIENTS` | off (required in production) | 401 | [L9-L14](../../apps/api/src/auth/token-checks.ts#L9-L14) |
| Revocation (introspection) | `AUTH_INTROSPECTION_URL`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_CACHE_SECONDS` (30), `_FAIL_OPEN` | off | closed (401) | [L31-L48](../../apps/api/src/auth/token-checks.ts#L31-L48) |
| Central entitlements | `ENTITLEMENT_URL`, `ENTITLEMENT_TOKEN`, `ENTITLEMENT_CACHE_SECONDS` (60), `ENTITLEMENT_FAIL_OPEN` | off | closed (401) | [L57-L74](../../apps/api/src/auth/token-checks.ts#L57-L74) |
| Step-up | `STEP_UP_MAX_AGE_SECONDS`, `STEP_UP_ACR_VALUES` | off (local stack: 3600 s) | 403 `step_up_required` | [L81-L88](../../apps/api/src/auth/token-checks.ts#L81-L88) |
| Production safety | `NODE_ENV=production`, `ALLOW_DEV_SETTINGS` | on in production | process refuses to start | [production-safety.ts#L6-L20](../../apps/api/src/production-safety.ts#L6-L20) |

---

## 1. Allowed clients (`azp` / `client_id`)

```ts
export function assertAllowedClient(payload: JWTPayload): void {
  const allowed = list(process.env.AUTH_ALLOWED_CLIENTS);
  if (!allowed.length) return;
  const client = typeof payload.azp === 'string' ? payload.azp : typeof payload.client_id === 'string' ? payload.client_id : '';
  if (!allowed.includes(client)) throw new UnauthorizedException('Token was issued to an unrecognised application');
}
```

- **Technical:** `azp` (authorized party) names the OAuth client that requested the token. Some IdPs use `client_id` instead.
- **Plain:** One bank IdP serves many apps. Without this check, a token that a *different* internal app obtained, which might even have the same audience, could be replayed against us. This is called a **confused-deputy** or **token substitution** risk.
- **Production:** `assertProductionSafety` refuses to start if this list is empty ([production-safety.ts#L17](../../apps/api/src/production-safety.ts#L17)).
- **Test:** [auth-hardening.spec.ts#L34](../../apps/api/test/auth-hardening.spec.ts#L34).

---

## 2. Revocation through introspection

**Problem:** a JWT is self-contained. If the user is disabled at 10:00 and their token expires at 10:15, the API would accept it for 15 more minutes.

**Solution:** ask the IdP ([token-checks.ts#L31-L48](../../apps/api/src/auth/token-checks.ts#L31-L48)):

```ts
const key = createHash('sha256').update(token).digest('hex');      // never cache the raw token
const cached = introspectionCache.get<boolean>(key);
if (cached !== undefined) { if (!cached) throw new UnauthorizedException('Token has been revoked'); return; }
const response = await fetch(url, { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` },
  body: new URLSearchParams({ token }), signal: AbortSignal.timeout(3000) });
const active = ((await response.json()) as { active?: boolean }).active === true;
introspectionCache.set(key, active, Number(process.env.AUTH_INTROSPECTION_CACHE_SECONDS ?? 30));
```

| Design choice | Plain reason |
|---|---|
| Cache key = **SHA-256 of the token** | The raw token is a bearer credential. Keeping it as a map key would turn a heap dump into stolen sessions. |
| Cache for **30 s** | Calling the IdP on every request is slow and makes the IdP a single point of failure. 30 s is the maximum revocation delay. |
| Cache **inactive** results too | A revoked token hammering the API does not hammer the IdP. |
| **3-second timeout** | A slow IdP must not hang our request threads. |
| **Fail closed** unless `AUTH_INTROSPECTION_FAIL_OPEN=true` | If we cannot confirm the token is active, we assume it isn't. Turning fail-open on is an explicit availability-over-security decision. |

The tiny `TtlCache` ([L16-L22](../../apps/api/src/auth/token-checks.ts#L16-L22)) is bounded at 5,000 entries and evicts the oldest-inserted entry first, so memory cannot grow without limit.

**Trade-off to explain in an interview:** local JWT verification is fast and highly available but blind to early revocation. Introspection shortens the blind window to 30 s at the cost of an online dependency, softened by the cache and the timeout.

Test: [auth-hardening.spec.ts#L41](../../apps/api/test/auth-hardening.spec.ts#L41) ("refuses revoked tokens... and fails closed if the lookup breaks").

---

## 3. Central entitlements

**Problem:** roles and queues in the token were frozen at login. If HR moves someone out of the payments team at 11:00, their token still says `queues: [payments]` until it expires.

**Solution:** optionally ask the bank's entitlement service ([token-checks.ts#L57-L74](../../apps/api/src/auth/token-checks.ts#L57-L74)):

```ts
const response = await fetch(`${url}?subject=${encodeURIComponent(subject)}`, { headers: ..., signal: AbortSignal.timeout(3000) });
if (response.status === 404) throw new UnauthorizedException('No entitlements are recorded for this user');
const value = (await response.json()) as EntitlementOverride;   // { roles?, queues?, branch?, department?, legal_entity?, country? }
entitlementCache.set(subject, value, Number(process.env.ENTITLEMENT_CACHE_SECONDS ?? 60));
```

- Fields the service returns **override** the token, and omitted fields fall back to the token ([auth.guard.ts#L87-L107](../../apps/api/src/auth/auth.guard.ts#L87-L107) uses `override?.x ?? token.x`).
- **404 = no record = denied.** Someone removed from the entitlement system loses access within a minute.
- Cache key is the **subject**, not the token, because entitlements belong to the person. 2,000 entries max, 60 s TTL.
- Fail closed unless `ENTITLEMENT_FAIL_OPEN=true`, which falls back to the signed token claims.

Test: [auth-hardening.spec.ts#L49](../../apps/api/test/auth-hardening.spec.ts#L49).

---

## 4. Step-up authentication

[token-checks.ts#L81-L88](../../apps/api/src/auth/token-checks.ts#L81-L88):

```ts
export function assertStepUp(user: UserContext, action: string): void {
  if (user.serviceIdentity) return;
  const maxAge = Number(process.env.STEP_UP_MAX_AGE_SECONDS ?? 0); const acrValues = list(process.env.STEP_UP_ACR_VALUES);
  if (!maxAge && !acrValues.length) return;
  const strongEnough = acrValues.length > 0 && user.acr !== undefined && acrValues.includes(user.acr);
  const recentEnough = maxAge > 0 && user.authTime !== undefined && Date.now() / 1000 - user.authTime <= maxAge;
  if (!strongEnough && !recentEnough) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'step_up_required', message: `Please sign in again to ${action}.` });
}
```

Read it as: **either a recent login OR a strong login is enough.**

| Configured | User's token | Result |
|---|---|---|
| nothing | anything | allowed (step-up off) |
| `MAX_AGE=3600` | logged in 10 min ago | allowed |
| `MAX_AGE=3600` | logged in 3 h ago | **403 step_up_required** |
| `ACR_VALUES=mfa` | `acr=mfa`, logged in 3 h ago | allowed (strong enough) |
| both | `acr=pwd`, 3 h ago | **403** |
| any | service identity | allowed (a robot can't answer a login prompt) |

### Where step-up is required

| Action | Call site |
|---|---|
| Reveal full customer references | [tickets.service.ts#L146](../../apps/api/src/tickets/tickets.service.ts#L146) |
| Approve / reject | [tickets.service.ts#L332](../../apps/api/src/tickets/tickets.service.ts#L332) |
| Legal hold / retention date | [tickets.service.ts#L105](../../apps/api/src/tickets/tickets.service.ts#L105) |
| Export audit report | [audit.controller.ts#L64](../../apps/api/src/audit/audit.controller.ts#L64) |
| Subject-access (privacy) export | [compliance.service.ts#L118](../../apps/api/src/compliance/compliance.service.ts#L118) |
| Complaints register CSV | [compliance.service.ts#L136](../../apps/api/src/compliance/compliance.service.ts#L136) |

### Why a structured error `code`
The browser must tell "you are not allowed" apart from "you are allowed, but sign in again". A machine-readable `code: 'step_up_required'` lets [api.ts#L74](../../apps/web/src/api.ts#L74) raise the banner without parsing English messages.

### Where `auth_time` and `acr` come from
The guard copies them from the verified token into `UserContext` ([auth.guard.ts#L131-L133](../../apps/api/src/auth/auth.guard.ts#L131-L133)). The browser's re-login uses `max_age: 0` ([auth.ts#L39](../../apps/web/src/auth.ts#L39)), which forces the IdP to re-prompt and issue a new `auth_time`.

Tests: [auth-hardening.spec.ts#L56-L76](../../apps/api/test/auth-hardening.spec.ts#L56) (does nothing unless configured, requires a recent login, accepts a strong level, exempts service identities, uses the machine-readable code).

---

## 5. Production safety gate

[production-safety.ts#L6-L20](../../apps/api/src/production-safety.ts#L6-L20) runs in `main.ts` **before Nest is even created** ([main.ts#L14](../../apps/api/src/main.ts#L14)).

| Refused in production | Why |
|---|---|
| `OIDC_ISSUER` / `PORTAL_OIDC_ISSUER` looks like localhost or `dev` | The dev realm's demo passwords are public; pointing production at it is effectively "no login" |
| `DATABASE_URL` contains the dev password | Default credentials |
| Object storage secret, `EMAIL_REFERENCE_SECRET`, `UPLOAD_LINK_SECRET`, introspection secret start with `local-` | Development secrets are in the repository |
| `AUTH_ALLOWED_CLIENTS` empty | Tokens for any app would be accepted |
| `AUDIT_REQUIRE_RESTRICTED_DB_ROLE` not `true` | The app might run as an account that can rewrite the audit trail |

It lists **every** problem at once, so an operator fixes them in one go, not one per restart. `ALLOW_DEV_SETTINGS=true` is the escape hatch for the local container stack only. Tests: [production-safety.spec.ts#L3-L19](../../apps/api/test/production-safety.spec.ts#L3).

**Plain:** a misconfiguration becomes a failed deployment, not a silent security hole.

---

## 6. Other hardening that touches auth

| Control | Where | Plain meaning |
|---|---|---|
| Logger redacts `authorization` and `cookie` headers | [main.ts#L15](../../apps/api/src/main.ts#L15) | Tokens never end up in logs |
| CORS allow-list, `authorization` header allowed only from listed origins | [main.ts#L22](../../apps/api/src/main.ts#L22) | Another website cannot call our API from a victim's browser |
| Rate limit 600/min per client | [main.ts#L18](../../apps/api/src/main.ts#L18) | Slows down token-guessing and flooding |
| SSE stream closes at token `exp` | [live-events.controller.ts#L31-L33](../../apps/api/src/live/live-events.controller.ts#L31-L33) | A long-lived connection cannot outlive its credential |
| Max 5 SSE streams per subject | [live-events.service.ts#L56-L58](../../apps/api/src/live/live-events.service.ts#L56-L58) | One stolen token cannot open hundreds of streams |

---

## 7. Interview framing

> I treat JWT verification as the baseline, not the finish line. On top of signature, issuer, audience and algorithm, I bind tokens to known clients, can check revocation through RFC 7662 introspection with a hashed, 30-second, fail-closed cache, and can pull live entitlements so role or queue removals apply within a minute. Sensitive actions require step-up (a recent or strong login), returned as a structured 403 the UI understands. And production refuses to boot with development identity settings or an audit-capable database account.

Next: [Authorization policy](authorization-policy.md)
