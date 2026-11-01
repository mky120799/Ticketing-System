# App shell and routing (staff console)

[Back to Frontend architecture index](README.md)

---

## 1. Provider tree

[main.tsx#L24-L38](../../apps/web/src/main.tsx#L24-L38):

```text
<StrictMode>
  <MantineProvider theme forceColorScheme="light">   design system, colours, components
    <Notifications />                                toast host
    <QueryClientProvider client={queryClient}>       server-data cache
      <BrowserRouter>                                URLs, Back button, shareable links
        <SessionProvider>                            who is signed in, /me, can(), step-up
          <App />
```

**Why this order:** `SessionProvider` uses `useNavigate` (after the callback) and `useQuery` (for `/me`), so it must sit inside both the router and the query provider. Every screen uses Mantine and toasts, so those go outermost. The comment at [main.tsx#L1-L9](../../apps/web/src/main.tsx#L1-L9) explains each one.

**StrictMode** runs effects twice in development to surface bugs. That's why `completeSignIn` caches its promise: the OIDC code is one-time ([auth/frontend-session.md](../auth/frontend-session.md#2-authts-the-usermanager)).

## 2. Session gates

[app.tsx#L34-L41](../../apps/web/src/app.tsx#L34-L41): `!ready` → loader; `!user` → login; `/me` failed → profile error; `/me` pending → loader; otherwise routes. A protected screen never flashes with unknown roles.

## 3. Routes

[app.tsx#L43-L55](../../apps/web/src/app.tsx#L43-L55):

| URL | Component | Capability | Loaded |
|---|---|---|---|
| `/` | redirect to `homePath(roles)` | n/a | n/a |
| `/tickets` | `TicketsPage` | `readCases` | eager |
| `/tickets/:ticketId` | `TicketPage` | `readCases` | eager |
| `/dashboard` | `DashboardPage` | `viewDashboard` | **lazy** |
| `/audit` | `AuditPage` | `viewAudit` | **lazy** |
| `/admin/:section` | `AdminPage` | `administer` | **lazy** |
| `/no-access`, `*` | status pages | n/a | eager |

- `React.lazy(() => import(...))` + `Suspense` ([L24-L26](../../apps/web/src/app.tsx#L24-L26), [L31](../../apps/web/src/app.tsx#L31)) split the heavy, less-used screens into separate bundles, so a case worker's first page loads fast.
- `Require` ([L29-L32](../../apps/web/src/app.tsx#L29-L32)) renders `NoAccessPage` without the capability. This is UX only.
- `homePath` ([roles.ts#L32](../../apps/web/src/session/roles.ts#L32)): case readers → `/tickets`, administrators → `/admin`, others → `/no-access`.

## 4. Layout

[app-layout.tsx#L33-L117](../../apps/web/src/layout/app-layout.tsx#L33-L117), Mantine `AppShell`:

```text
┌──────────────────────────────────────────────────────────────┐
│ header: brand · Live badge · notifications · user menu       │
├────────────┬─────────────────────────────────────────────────┤
│ nav (by    │ <StepUpBanner/>                                 │
│ capability)│ <Outlet/> (current route)                       │
│ scope foot │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

- Navigation items filtered by `can(capability)` ([L26-L31](../../apps/web/src/layout/app-layout.tsx#L26-L31), [L86](../../apps/web/src/layout/app-layout.tsx#L86)); "Tickets" stays highlighted on `/tickets/123` ([L94](../../apps/web/src/layout/app-layout.tsx#L94)).
- Live updates and the notification bell only for case workers ([L38-L39](../../apps/web/src/layout/app-layout.tsx#L38-L39)).
- A scope footer ("Branch BLR-01 · BANK-IN / IN, Queues: ...") explains why people see what they see ([L101-L108](../../apps/web/src/layout/app-layout.tsx#L101-L108)).
- The nav collapses behind a burger on small screens.

## 5. URL as state

Filters, search, the active tab and the admin section all live in the URL (`?view=mine&q=card`, `?tab=attachments`, `/admin/templates`), so Back, refresh and shared links all work. See [tickets queue](../tickets/frontend-queue.md#3-url-as-state).
