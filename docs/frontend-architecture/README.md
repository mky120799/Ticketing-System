# Frontend architecture

Two React + Vite + TypeScript apps share one API:

| App | Folder | Users | Key libraries |
|---|---|---|---|
| **Staff console** | [apps/web](../../apps/web/src/) | agents, supervisors, auditors, administrators | Mantine UI, TanStack Query, TanStack Table, React Router, oidc-client-ts, @mantine/charts |
| **Customer portal** | [apps/portal](../../apps/portal/src/) | bank customers, link holders | Mantine UI, oidc-client-ts (plain React state) |

This folder covers the **cross-cutting** frontend patterns. Feature screens are documented in their topic folders: [tickets queue](../tickets/frontend-queue.md), [case workspace](../tickets/frontend-workspace.md), [auth session](../auth/frontend-session.md), [audit](../audit/frontend.md), [communications](../communications/frontend.md), [attachments](../attachments/frontend.md), [compliance](../compliance/frontend.md), [configuration](../configuration/frontend.md), [dashboard](../dashboard/how-it-works.md#5-frontend), [live updates](../live-updates/frontend.md), [portal](../portal/frontend.md).

## The one rule

> **The frontend decides what to show. The API decides what is allowed.** Capabilities, hidden buttons and cached data are presentation. Every request carries the current token, and the API re-checks identity, permission, scope and state. The UI must cope gracefully when the server says no (403/404/409), even for something it showed a moment ago.

## Read in this order

1. [App shell and routing](app-shell-and-routing.md): providers, session gates, routes, lazy loading, layout.
2. [API client](api-client.md): `api.ts`, headers, error mapping, special paths (cursor header, blobs, uploads, SSE).
3. [Data fetching with TanStack Query](data-fetching.md): query client defaults, keys, mutations, cache patching.
4. [UI conventions](ui-conventions.md): runtime config, theme and contrast, labels table, states, accessibility, toasts.
5. [Interview Q&A](interview-qa.md)

## Code-reading order for any screen

```text
route in app.tsx → page component → session capability (show/hide)
→ typed function in api.ts → TanStack Query hook + key
→ backend controller/service → success: invalidate/patch · failure: 401/403/404/409 handling
```

## 30-second answer

> The staff console wraps the app in Mantine, a toast host, a TanStack Query client, the router and a session provider, in that dependency order. It waits for OIDC and `/me` before rendering routes, lazy-loads the heavy screens and gates routes by capabilities for UX. All HTTP goes through one typed client that adds the Bearer token and a correlation ID, signs out on 401 and raises a step-up event on a coded 403. Server state lives in TanStack Query with hierarchical keys, no automatic mutation retries, and a shared mutation hook that refetches the changed ticket and patches every list. SSE events only trigger refetches.
