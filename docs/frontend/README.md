# Frontend architecture

There are two React/Vite applications: the staff console in `apps/web` and the customer portal in `apps/portal`. They share the API contract but have separate identity configuration, routes, presentation and security boundaries.

## Staff console

1. [Bootstrap, providers and routing](staff-console-bootstrap-and-routing.md)
2. [Authentication and session](authentication-and-session.md)
3. [Typed API client and errors](api-data-flow.md)
4. [Ticket list and React Query cache](ticket-list-and-react-query.md)
5. [Ticket workspace](ticket-workspace.md)
6. [Administration frontend](administration.md)
7. [Backend live-event synchronization](../modules/live-events.md)
8. [Audit frontend](../modules/audit/frontend.md)

## Customer application

- [Customer portal frontend](customer-portal.md)
- [Backend portal boundary](../modules/portal.md)
- [Attachments and secure upload links](../modules/tickets/attachments-scanning-and-upload-links.md)

## Non-negotiable frontend rule

Capabilities, routes, hidden buttons and cached data are presentation. Every API request sends the current access token, and the API revalidates identity, permission, resource scope and current state. The frontend must safely handle the server revoking data it could see moments earlier.

## Code-reading order for one screen

```text
route in app.tsx
-> page/component
-> session capability (presentation)
-> typed function in api.ts
-> TanStack Query hook/key
-> backend controller/service
-> success invalidation or structured error recovery
```

Use the [frontend-to-backend implementation map](../modules/reference/frontend-to-backend-map.md) to locate the matching Nest owner and cache behavior for every major screen.

## Frontend completion standard

A feature is not complete merely because it renders the happy path. It must use the shared authenticated client, preserve user input during safe retry, disable duplicate submission while pending, handle 401/403/404/409 distinctly, refetch authoritative state after changes/live hints, render untrusted text without HTML injection and expose accessible labels/focus behavior. The API must still enforce every permission and state rule when the UI is bypassed.
