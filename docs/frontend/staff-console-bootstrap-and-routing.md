# Staff console: bootstrap, providers and routing

[`main.tsx`](../../apps/web/src/main.tsx) builds the client dependency tree; [`app.tsx`](../../apps/web/src/app.tsx) decides which authenticated screen a URL renders.

## Provider order

```text
React StrictMode
  -> MantineProvider (theme and CSS variables)
  -> Notifications (toast host)
  -> QueryClientProvider (server-state cache)
  -> BrowserRouter (URL/navigation context)
  -> SessionProvider (OIDC user, /me profile and capabilities)
  -> App
```

Order is functional. Session uses navigation after callback, so it must be inside BrowserRouter. Feature hooks use both session and React Query, so they must be below both providers. Mantine/Notifications wrap screens that render their components/toasts.

React StrictMode can run effects twice in development. `auth.ts` caches the callback promise because an OIDC authorization code is one-time and cannot be redeemed twice.

## Application state gates

`App` renders in this order:

1. Session initialization incomplete → full-page loader.
2. No OIDC user → login page.
3. User exists but `/me` failed → profile-error page.
4. `/me` still pending → loader.
5. User and profile exist → protected route tree.

This prevents protected screens from briefly rendering against unknown roles/scope.

## Route table

| URL | Component | UI capability |
|---|---|---|
| `/` | redirect through `homePath` | derived from roles |
| `/tickets` | `TicketsPage` | `readCases` |
| `/tickets/:ticketId` | `TicketPage` | `readCases` |
| `/dashboard` | lazy `DashboardPage` | `viewDashboard` |
| `/audit` | lazy `AuditPage` | `viewAudit` |
| `/admin/:section` | lazy `AdminPage` | `administer` |
| `/no-access` | no-access page | none |
| unmatched | not-found page | none |

Large, less frequent dashboard/audit/admin bundles use `React.lazy` and `Suspense`; primary ticket routes are eager. `Require` renders a no-access page when the frontend capability is absent. This is UX only: direct API use still reaches `AuthGuard`/`PolicyService`.

`homePath` sends case readers to `/tickets`, administrators to `/admin`, and identities with neither capability to `/no-access`. Administrators intentionally have no ticket capability.

## Layout and live connection

[`app-layout.tsx`](../../apps/web/src/layout/app-layout.tsx) renders navigation based on capabilities, user identity, notification menu, live connection state, step-up banner and nested `<Outlet>`. It enables `useLiveUpdates` only for case-reading sessions.

Navigation filtering prevents confusing dead links but is not data filtering. Screens must still render API 401/403/404 safely.

## Runtime configuration and styling

`config.ts` reads runtime-injected API/OIDC settings, allowing one built image to be deployed in multiple environments. `theme.ts` centralizes accessible color/design overrides. Global CSS should not contain permission logic or hidden sensitive data.

## Tests and interview answer

Test provider-dependent hooks under the same wrapper, StrictMode callback-once, each session gate, home-route mapping, lazy fallback, direct unauthorized route and not-found behavior.

> I bootstrap the console with design, toast, query, router and session providers in dependency order. The root app waits for both OIDC and `/me`, then maps routes through coarse capabilities and lazy-loads heavier screens. Those route checks are presentation only; the API remains authoritative. StrictMode-safe callback caching prevents the one-time OIDC code being redeemed twice.
