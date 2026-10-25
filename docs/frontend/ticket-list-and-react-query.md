# Frontend: ticket list and React Query

The ticket queue combines cursor-paged server data with URL-persisted presentation filters and targeted cache synchronization.

## Query hook

[`useTicketList(search)`](../../apps/web/src/features/tickets/use-ticket-queries.ts) uses `useInfiniteQuery` with key `['tickets','list',search]`.

- Empty search calls `listTicketsPage(user, pageParam)` and follows the response cursor.
- Non-empty search calls the bounded search API and wraps it as one page with no next cursor.
- `keepPreviousData` prevents a blank flash while a debounced term changes.

Categories use a ten-minute stale time because they change infrequently. Ticket detail uses `['ticket', id]` and retrieves the complete projection.

## URL and local state

[`tickets-page.tsx`](../../apps/web/src/features/tickets/tickets-page.tsx) stores view, status, priority, queue and search in `URLSearchParams`. Browser Back/bookmarks preserve the working queue. Search text is debounced 350 ms before updating URL/query.

Quick views—open, mine, unassigned, overdue, complaints, all—filter only loaded authorized rows. This is presentation, not a complete server report: before all pages load, counts reflect loaded rows. Search mode disables views requiring fields absent from the minimal search projection.

Status filter choices come from loaded data; queues come from `/me` profile. A clear action removes filters while preserving a non-default view where appropriate.

## Cache patching

[`ticket-cache.ts`](../../apps/web/src/features/tickets/ticket-cache.ts) avoids refetching every list after one ticket changes:

1. `refreshTicket` performs an authorized detail GET.
2. It writes the full detail cache.
3. `toRow` removes nested collections.
4. Every cached ticket list containing the id receives the fresh row.
5. A new visible row can be prepended to unfiltered lists, never guessed into search results.
6. Ticket-audit query is invalidated.

If refetch returns 403/404, the ticket is removed from all lists and its detail query reset. This handles reassignment/sensitivity changes without leaving stale data. Network errors are ignored so temporary connectivity does not erase still-valid cached work.

## Mutation hook

`useTicketMutation` receives an action and optional success message. On success it awaits `refreshTicket`, ensuring detail/list align before the toast. On `409` it also refreshes so the user sees the version that beat their change. Global mutation error handling shows other failures.

This does not make the frontend transactionally consistent: the API is authority, and an SSE or later refetch can supersede cache state.

## Rendering states and accessibility

The page renders loading skeleton, retryable error block, filter-aware empty state or accessible table. The loaded/shown count is announced through `aria-live`. Search/select controls have labels, and horizontal view controls use a scroll area on narrow screens.

## Current limitations

- Quick-view counts are client counts over loaded pages, not complete queue totals.
- Search results omit assignee/SLA, so row capabilities vary by mode.
- `patchTicketInLists(addIfMissing: true)` may add a newly fetched ticket to every unfiltered cached list regardless of local view semantics; current keys only encode search because other views are client filters.
- Server-side filters would be needed for very large queues and exact counts.

## Interview answer

> I use an infinite query keyed by the search term for cursor paging and a debounced one-page server search. View/filter state lives in the URL. After a mutation or SSE hint, I refetch one ticket through the authorized API and patch it into detail and list caches; if access is gone, I remove it. A 409 also refetches. Quick-view counts are explicitly counts of loaded data, not backend-wide reporting.
