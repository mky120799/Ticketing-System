/**
 * Keeping cached tickets correct after something changes.
 *
 * The queue (a list) and the case screen (one ticket) are cached separately. When a ticket changes, because the
 * user saved something or a live event said someone else did, we re-read it from the API (the only source that
 * applies access policy) and write the fresh copy into both places. That avoids re-downloading whole lists.
 */
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { ApiError, getTicket, type Ticket, type TicketListItem } from '../../api';
import { queryKeys } from '../../lib/query-keys';

/** A row in the queue. The paged list returns most ticket fields; search returns only the minimal ones. */
export type QueueTicket = TicketListItem & Partial<Omit<Ticket, keyof TicketListItem>>;
export interface TicketPage { items: QueueTicket[]; next: string | null }
export type TicketListData = InfiniteData<TicketPage, string | undefined>;

/** The list does not need a ticket's notes, attachments and so on: strip them before storing a row. */
function toRow(ticket: Ticket): QueueTicket {
  const { notes, attachments, history, references, communications, relatedTickets, retention, ...row } = ticket;
  return row;
}

/**
 * Writes a fresh ticket into every cached list that shows it. A brand-new ticket is added to the top of the
 * unfiltered queue, but not to search results, whose contents depend on the search term.
 */
export function patchTicketInLists(queryClient: QueryClient, ticket: Ticket, options: { addIfMissing: boolean }): void {
  const row = toRow(ticket);
  for (const [key, data] of queryClient.getQueriesData<TicketListData>({ queryKey: queryKeys.ticketLists })) {
    if (!data) continue;
    const search = key[2] as string;
    const present = data.pages.some((page) => page.items.some((item) => item.id === ticket.id));
    if (present) {
      queryClient.setQueryData<TicketListData>(key, {
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => (item.id === ticket.id ? { ...item, ...row } : item)) }))
      });
    } else if (options.addIfMissing && !search && data.pages.length > 0) {
      const [first, ...rest] = data.pages;
      queryClient.setQueryData<TicketListData>(key, { ...data, pages: [{ ...first, items: [row, ...first.items] }, ...rest] });
    }
  }
}

/** Removes a ticket from every cached list, e.g. when it moved to a queue the user cannot see. */
export function removeTicketFromLists(queryClient: QueryClient, ticketId: string): void {
  queryClient.setQueriesData<TicketListData>({ queryKey: queryKeys.ticketLists }, (data) =>
    data && { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => item.id !== ticketId) })) });
}

/**
 * Re-reads one ticket and updates every cache that holds it. If the API now says 403/404, the ticket is no longer
 * visible to this user (reassigned, made restricted...): it disappears from lists and an open case screen shows
 * "not available". Network errors are ignored; the next live event or refresh will catch up.
 */
export async function refreshTicket(queryClient: QueryClient, user: User, ticketId: string): Promise<void> {
  try {
    const fresh = await getTicket(user, ticketId);
    queryClient.setQueryData(queryKeys.ticket(ticketId), fresh);
    patchTicketInLists(queryClient, fresh, { addIfMissing: true });
    void queryClient.invalidateQueries({ queryKey: queryKeys.ticketAudit(ticketId) });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      removeTicketFromLists(queryClient, ticketId);
      void queryClient.resetQueries({ queryKey: queryKeys.ticket(ticketId), exact: true });
    }
  }
}
