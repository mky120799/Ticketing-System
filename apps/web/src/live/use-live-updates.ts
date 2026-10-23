/**
 * Live updates: keeps every open screen current without the user pressing refresh.
 *
 * The server pushes tiny events over Server-Sent Events (SSE): "ticket X changed", "you have a notification",
 * or "resync" (you may have missed events). Events carry only an ID, never ticket content, so a leaked event
 * reveals nothing. We react by re-reading the data through the normal, policy-checked REST API.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { subscribeToLiveEvents } from '../api';
import { queryKeys } from '../lib/query-keys';
import { refreshTicket } from '../features/tickets/ticket-cache';

/** Subscribes while `enabled`; returns whether the stream is currently connected (shown as "Live" in the header). */
export function useLiveUpdates(user: User | null, enabled: boolean): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user || !enabled) return;
    // Re-subscribes when `user` changes: a renewed token must be used for the next connection.
    return subscribeToLiveEvents(user, {
      onTicket: (event) => void refreshTicket(queryClient, user, event.ticketId),
      onNotification: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
      // After a disconnect anything may be stale: refetch whatever is on screen.
      onResync: () => void queryClient.invalidateQueries(),
      onConnection: setConnected
    });
  }, [user, enabled, queryClient]);

  return connected;
}
