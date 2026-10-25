# Frontend interview answers

Use these quick answers after practicing the full [code-level answer playbook](code-level-answer-playbook.md), especially its frontend state/cache/error trace.

## “How does login work in the frontend?”

`login-page.tsx` starts the redirect; `auth.ts` uses OIDC Authorization Code + PKCE; `session-provider.tsx` completes the callback, renews/signs out and loads `/me`; `api.ts` attaches the access token to requests.

## “How do frontend permissions work?”

`roles.ts` maps roles to capabilities and `app.tsx`/`app-layout.tsx` hide unavailable screens and actions. That is presentation only. The API still verifies the token and policy on every request.

## “How does the UI stay current?”

React Query owns server data and stable query keys. Mutations invalidate affected keys. SSE carries minimal ids through `use-live-updates.ts`; the client refetches the authoritative resource rather than trusting event payloads.

## “How does step-up work in the UI?”

The API returns structured `step_up_required`; `api.ts` notifies session state; `step-up-banner.tsx` calls `reauthenticate()` with `max_age: 0`, preserving the return path. The API then validates the new authentication context.
