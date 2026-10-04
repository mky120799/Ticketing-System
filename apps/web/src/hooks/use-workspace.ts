import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { getNotifications, getTicket, listTickets, listTicketsPage, markNotificationsRead, searchTickets, subscribeToLiveEvents, type StaffNotification, type Ticket, type TicketListItem } from '../api';

/**
 * The case workspace's data: the paged ticket list, search, the selected ticket, the notification inbox and the live feed.
 * Live events carry only an ID; the authoritative, policy-checked ticket is always re-read over REST.
 */
export function useWorkspace(user: User | null, enabled: boolean, onError: (message: string) => void) {
  const [tickets, setTickets] = useState<TicketListItem[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null); const [searchTerm, setSearchTerm] = useState('');
  const [live, setLive] = useState(false); const [inbox, setInbox] = useState<{ notifications: StaffNotification[]; unread: number }>({ notifications: [], unread: 0 });
  const selectedIdRef = useRef<string | null>(null); const searchTermRef = useRef('');
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; searchTermRef.current = searchTerm; }, [selected?.id, searchTerm]);

  useEffect(() => {
    if (!user || !enabled) return;
    void listTicketsPage(user).then((page) => { setTickets(page.items); setNextCursor(page.next); }).catch((e: Error) => onError(e.message));
  }, [user, enabled, onError]);

  useEffect(() => {
    if (!user || !enabled) return;
    const refreshOne = async (id: string) => {
      try {
        const fresh = await getTicket(user, id);
        setTickets((current) => current.some((ticket) => ticket.id === id) ? current.map((ticket) => ticket.id === id ? { ...ticket, ...fresh } : ticket) : searchTermRef.current.trim() ? current : [fresh, ...current]);
        if (selectedIdRef.current === id) setSelected(fresh);
      } catch { // no longer visible to this user (for example reassigned to another queue)
        setTickets((current) => current.filter((ticket) => ticket.id !== id));
        if (selectedIdRef.current === id) setSelected(null);
      }
    };
    const loadInbox = () => { void getNotifications(user).then(setInbox).catch(() => undefined); };
    const resync = () => { if (!searchTermRef.current.trim()) void listTickets(user).then(setTickets).catch(() => undefined); if (selectedIdRef.current) void refreshOne(selectedIdRef.current); loadInbox(); };
    loadInbox();
    return subscribeToLiveEvents(user, { onTicket: (event) => void refreshOne(event.ticketId), onNotification: loadInbox, onResync: resync, onConnection: setLive });
  }, [user, enabled]);

  const select = useCallback(async (id: string) => { if (!user) return; try { setSelected(await getTicket(user, id)); } catch (e) { onError(e instanceof Error ? e.message : 'Unable to retrieve ticket'); } }, [user, onError]);
  const refreshSelected = useCallback(async () => { if (!user || !selectedIdRef.current) return; setSelected(await getTicket(user, selectedIdRef.current)); }, [user]);
  const search = async (event: FormEvent) => {
    event.preventDefault(); if (!user) return;
    try { if (searchTerm.trim()) { setTickets(await searchTickets(user, searchTerm.trim())); setNextCursor(null); } else { const page = await listTicketsPage(user); setTickets(page.items); setNextCursor(page.next); } }
    catch (e) { onError(e instanceof Error ? e.message : 'Unable to search tickets'); }
  };
  const loadMore = () => { if (!user || !nextCursor) return; void listTicketsPage(user, nextCursor).then((page) => { setTickets((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]); setNextCursor(page.next); }).catch((e: Error) => onError(e.message)); };
  const show = (ticket: Ticket) => setSelected(ticket);
  const added = (ticket: Ticket) => { setTickets((current) => [ticket, ...current]); setSelected(ticket); };
  const statusChanged = (id: string, status: string) => setTickets((current) => current.map((ticket) => ticket.id === id ? { ...ticket, status } : ticket));
  const openNotification = (ticketId: string, notificationId: string) => { void select(ticketId); void markNotificationsRead(user!, [notificationId]).then(() => getNotifications(user!)).then(setInbox); };
  const markAllRead = () => { if (user) void markNotificationsRead(user).then(() => getNotifications(user)).then(setInbox); };

  return { tickets, nextCursor, selected, searchTerm, setSearchTerm, live, inbox, select, refreshSelected, search, loadMore, show, added, statusChanged, openNotification, markAllRead };
}
