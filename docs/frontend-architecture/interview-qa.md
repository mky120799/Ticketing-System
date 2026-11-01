# Frontend architecture interview Q&A

[Back to Frontend architecture index](README.md)

---

**Q1. How is the app bootstrapped?**
> Mantine, toasts, the TanStack Query client, the router and the session provider, in dependency order. The app waits for OIDC and `/me` before rendering routes, and heavy screens are lazy-loaded.

**Q2. How do frontend permissions work?**
> Roles from `/me` map to coarse capabilities that hide routes and buttons. That's presentation only; the API re-checks everything, and the UI handles 403/404 gracefully.

**Q3. How do you keep server data consistent across screens?**
> TanStack Query with hierarchical keys. After a mutation or an SSE hint, I refetch the one ticket and patch it into the detail cache and every list; resync invalidates everything.

**Q4. Why no automatic mutation retries?**
> A retried POST could create or apply twice. Reads retry only on network/5xx errors.

**Q5. How do you handle a stale edit?**
> Mutations send `expectedUpdatedAt`; on a 409 the shared hook refetches so the user sees the newer version.

**Q6. Why fetch-based SSE?**
> `EventSource` can't send an Authorization header, and tokens mustn't be in URLs.

**Q7. How is one build deployed to many banks?**
> Runtime `/config.js` sets the API URL and OIDC authority/client at container start; build-time env is only a local fallback.

**Q8. Why does the portal not use TanStack Query?**
> It's tiny and low-frequency. Plain state with an explicit refresh after each action is simpler and smaller.

**Q9. What would you improve?**
> Clear the query cache on sign-out or user change, generate API types from an OpenAPI schema with runtime validation, add server-side filtering for exact queue counts, and add component tests for the session and mutation hooks.
