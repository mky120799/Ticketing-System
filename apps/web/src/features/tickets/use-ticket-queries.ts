/**
 * Data hooks for tickets. Components call these instead of the API directly, so caching, paging and
 * refresh-after-change behave the same everywhere.
 */
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, getCategories, getTicket, listTicketsPage, searchTickets } from '../../api';
import { notifySuccess } from '../../lib/notify';
import { queryKeys } from '../../lib/query-keys';
import { useSignedInUser } from '../../session/session-provider';
import { refreshTicket, type TicketPage } from './ticket-cache';

/**
 * The queue. Without a search term: the paged list (50 per page, "Load more" fetches the next page using the
 * cursor). With a search term: one page of search results. `keepPreviousData` keeps the old rows on screen while
 * a new search runs, instead of flashing an empty table.
 */
export function useTicketList(search: string) {
  const user = useSignedInUser();
  return useInfiniteQuery({
    queryKey: queryKeys.ticketList(search),
    queryFn: async ({ pageParam }): Promise<TicketPage> => (search ? { items: await searchTickets(user, search), next: null } : listTicketsPage(user, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData
  });
}

/** One ticket with everything the case screen needs (notes, history, attachments...). */
export function useTicket(ticketId: string) {
  const user = useSignedInUser();
  return useQuery({ queryKey: queryKeys.ticket(ticketId), queryFn: () => getTicket(user, ticketId) });
}

/** Categories in the user's scope, each with its default queue. Rarely changes, so cached for 10 minutes. */
export function useCategories() {
  const user = useSignedInUser();
  return useQuery({ queryKey: queryKeys.config('categories'), queryFn: () => getCategories(user), staleTime: 600_000 });
}

/**
 * A change to one ticket (add note, change status, assign...). After it succeeds the ticket is re-read and every
 * screen showing it updates. If the API answers 409 ("changed by someone else"), the ticket is re-read too, so the
 * person immediately sees the newer version they were about to overwrite.
 *
 * Usage: `const addNote = useTicketMutation(id, (user, body: string) => api.addNote(user, id, body), 'Note added');`
 */
export function useTicketMutation<TVariables, TResult = unknown>(
  ticketId: string,
  action: (user: ReturnType<typeof useSignedInUser>, variables: TVariables) => Promise<TResult>,
  successMessage?: string | ((result: TResult) => string)
) {
  const user = useSignedInUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => action(user, variables),
    onSuccess: async (result) => {
      await refreshTicket(queryClient, user, ticketId);
      if (successMessage) notifySuccess(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) void refreshTicket(queryClient, user, ticketId);
    }
  });
}
