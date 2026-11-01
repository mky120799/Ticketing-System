# Auth interview Q&A

Practise out loud: the 30-second answer, then the 2-minute answer, then be ready to open the code. Each answer names real files so you can point at them.

[Back to Auth index](README.md) · General technique: [answer playbook](../interview-prep/answer-playbook.md)

---

## 1. The three answer levels

### 30 seconds
> Staff log in with OpenID Connect Authorization Code plus PKCE, so our app never sees a password. The browser keeps the token in sessionStorage and sends it as a Bearer header. A NestJS `AuthGuard` verifies the JWT against the IdP's public keys (JWKS) with an asymmetric algorithm allow-list, checks issuer, audience and expiry, and builds a typed `UserContext`. `PolicyService` then authorises each action against the ticket's entity, country, queue, branch, owner and sensitivity. Frontend role checks only hide buttons.

### 2 minutes
> **Browser.** `auth.ts` configures `oidc-client-ts` with response type `code`, so PKCE is automatic. The page the user wanted goes in `state` and comes back through `safeReturnPath`, which blocks open redirects. `completeSignIn` caches its promise because StrictMode would otherwise redeem the one-time code twice. `SessionProvider` then loads `/me`, listens for silent renewal and expiry, and shows a step-up banner when the API asks for it.
>
> **API.** `AuthGuard.canActivate` requires a Bearer header and calls `jose.jwtVerify` with the remote JWKS, issuer, audience and `RS256/ES256/PS256` only. It can then check that the token was issued to an allowed client (`azp`), check revocation through RFC 7662 introspection with a hashed 30-second fail-closed cache, and pull live entitlements. `toUserContext` keeps only known roles and requires full organisational scope for humans. Every failure becomes one generic 401.
>
> **Authorization.** Services load the ticket and call `assertTicketAccess`: role permission first, then same entity and country, queue, branch-or-ownership for agents, and restricted sensitivity for seniors only. Sensitive actions add step-up and maker-checker. Every 403 is written to the audit trail by a global interceptor.

### Code-level (point at these)
```text
apps/web/src/auth.ts                  UserManager, signIn, safeReturnPath, reauthenticate, completeSignIn
apps/web/src/session/session-provider.tsx   callback effect, events, /me query
apps/web/src/api.ts                   authHeaders, failure(): 401 → signOut, step_up_required → event
apps/api/src/auth/auth.guard.ts       canActivate L45-79, toUserContext L81-139
apps/api/src/auth/token-checks.ts     assertAllowedClient, assertTokenActive, lookupEntitlements, assertStepUp
apps/api/src/auth/policy.service.ts   PERMISSIONS L8-13, assertTicketAccess L22-32
apps/api/src/audit/denied-authorization.interceptor.ts   403 → authorization.denied
```

---

## 2. Likely questions and model answers

**Q1. What's the difference between authentication and authorization in your system?**
> Authentication is the guard: is this a genuine token from our IdP, for our API, still valid? The output is a `UserContext`. Authorization is `PolicyService` in the service layer: may this user do this action to *this* ticket? It needs the database row, which is why it can't live in the guard.

**Q2. Why Authorization Code + PKCE instead of implicit flow?**
> Implicit flow returns tokens in the URL fragment, where they can leak through history, referrers and extensions. Code flow returns a one-time code, and PKCE ties that code to a secret only our tab holds, so a stolen code is useless. It's the current OAuth best practice for browser apps.

**Q3. How do you know a JWT is genuine?**
> By verifying the signature against the IdP's published public key, chosen by the token's `kid` from the JWKS. Decoding isn't verifying. Then I check `iss` equals our issuer, `aud` equals our API, and `exp`/`nbf`, all in `jwtVerify` with an explicit algorithm list.

**Q4. Why the algorithm allow-list?**
> To stop algorithm-confusion attacks: `alg: none` or `HS256` signed with the public key. We allow only RS256, ES256 and PS256, and `auth-hardening.spec.ts` has a test that forges an HS256 supervisor token and expects 401.

**Q5. A user is fired at 10:00 and their token expires at 10:15. What happens?**
> With plain JWTs they'd keep access until 10:15. If introspection is enabled, the guard asks the IdP and caches the answer for 30 seconds, so access ends within about 30 seconds. If the entitlement service removes them, a 404 there denies them within the 60-second cache. Both checks fail closed by default.

**Q6. Why hash the token for the introspection cache key?**
> The raw token is a bearer credential. If I used it as a map key, a heap dump or a debug log of the cache would leak usable sessions. A SHA-256 digest identifies the token without being one.

**Q7. Why do humans need branch, department, entity and country, but services don't?**
> Human access is scoped by those attributes. If one were missing, some query might treat an empty string as "no restriction", so I refuse the token instead. Service identities have exactly one narrow permission, like `attachment:scan`, and never read tickets, so the single permission is their boundary.

**Q8. Where do roles come from?**
> From the token (`roles` or Keycloak's `realm_access.roles`), or overridden by the bank's entitlement service when it's configured. Either way they're filtered against a closed list, so an unknown role grants nothing.

**Q9. Explain step-up.**
> Some actions (revealing references, approving, legal holds, exports) need a recent or strong login even though the session is valid. `assertStepUp` accepts either `auth_time` within `STEP_UP_MAX_AGE_SECONDS` or an `acr` in `STEP_UP_ACR_VALUES`. Otherwise it throws a 403 with `code: step_up_required`. The browser sees the code, shows a banner and re-runs the OIDC redirect with `max_age=0`. The user then retries deliberately; we don't auto-replay sensitive actions.

**Q10. What is maker-checker and how is it enforced?**
> The requester can't approve their own request. In `decideApproval` I lock the approval row, check `ticket:approve`, require step-up, then call `assertMakerChecker(requested_by, user.subject)`. That's a hard 403, and it's audited.

**Q11. How do you stop a case agent seeing another branch's tickets?**
> `assertTicketAccess`: agents need the ticket's queue in their queues **and** either the same branch or to be the creator or assignee. Supervisors and auditors are queue-wide. Restricted tickets are seniors-only.

**Q12. Can an administrator read customer data?**
> No. The administrator role has `configuration:write` and `sla:reconcile` but no `ticket:read`. That's separation of duties, and there's a unit test for it.

**Q13. What does the frontend role check do, then?**
> It hides buttons and routes for a tidy UI (`roles.ts`). It is never security. If someone forces a route, the API returns 403, and the ticket page shows 403 and 404 identically so it doesn't reveal that a ticket exists.

**Q14. What happens when authorization fails?**
> The service throws `ForbiddenException`, and the business transaction rolls back. The global `DeniedAuthorizationInterceptor` catches the 403, writes `authorization.denied` with actor, correlation ID and path in a **new** transaction, and rethrows the original error.

**Q15. Why aren't 401s audited?**
> There's no trusted actor to attribute them to; anyone can send garbage. They belong in edge and security logs (WAF, gateway), without the raw token.

**Q16. How are staff and customer identities kept apart?**
> Different IdP realm, issuer, audience and guard. `PortalAuthGuard` writes `request.customer` with only a subject; `AuthGuard` writes `request.user`. Each guard checks its own issuer and audience, so tokens can't cross. The portal integration test proves it.

**Q17. Where is the token stored in the browser and why?**
> sessionStorage via `WebStorageStateStore`. It's cleared when the tab closes and isn't shared across tabs, unlike localStorage. It's still JavaScript-readable, so XSS prevention (CSP, React escaping, dependency hygiene) remains essential.

**Q18. What stops a long-lived SSE connection outliving the token?**
> The SSE controller schedules a close at the token's `exp` and sends an `expired` event. The client reconnects with the renewed token.

**Q19. What if the IdP's signing key rotates?**
> `createRemoteJWKSet` caches keys and refetches when it sees an unknown `kid`, so rotation needs no restart.

**Q20. How do you prevent misconfiguration in production?**
> `assertProductionSafety` runs before Nest starts. It refuses development issuers, dev passwords and secrets, an empty `AUTH_ALLOWED_CLIENTS`, and an audit-capable DB role, and it lists every problem at once.

---

## 3. Follow-up traps (and how to handle them)

| Trap | Strong answer |
|---|---|
| "So JWTs are stateless and can't be revoked?" | "By default yes; that's why I added optional introspection with a bounded 30-second cache. It's a deliberate latency-vs-availability trade-off." |
| "Isn't checking policy in every service repetitive?" | "The *call* is one line; the logic is centralised in `PolicyService`. It must run where the row is loaded, inside the transaction." |
| "Why not use Nest's `@Roles()` decorator?" | "It only answers RBAC. Our rules depend on row attributes (queue, branch, owner, sensitivity), which aren't known until the service loads the ticket." |
| "Your frontend has the same matrix, so isn't that duplication?" | "Yes, deliberately: it's for UX only. The API is the authority; a drifting UI just shows a button that returns 403." |
| "What if the entitlement service is down?" | "Fail closed by default (401). `ENTITLEMENT_FAIL_OPEN=true` falls back to token claims if the bank prefers availability." |

---

## 4. Honest limitations (say them before they ask)

1. **Manual assignment doesn't validate the assignee.** It checks the supervisor's queue scope but not that the assignee is an active member of the target queue. Fix: check `queue_members` in the transaction.
2. **Ticket rows are read without `FOR UPDATE`.** Policy is evaluated on a snapshot. Fix: a conditional update (`WHERE updated_at = $expected`) or a row lock.
3. **`/me` is cached forever in the UI.** The API enforces changes immediately, but menus may lag. Fix: invalidate on token renewal.
4. **Step-up is configuration.** If both env vars are unset, sensitive actions don't ask. Production must set them, ideally with an MFA `acr`.

Use this pattern: *current guarantee → exact gap → concrete fix → how I'd prove it.*

---

## 5. If you blank in the interview

> "I don't remember the exact method name, but the invariant is that the guard verifies the signature against JWKS with a fixed algorithm list, then binds issuer, audience and client, and only allow-listed claims reach the service. Authorization happens after the row is loaded, in one policy service. I'd open `auth.guard.ts` and `policy.service.ts` to show you."

This is better than inventing names.
