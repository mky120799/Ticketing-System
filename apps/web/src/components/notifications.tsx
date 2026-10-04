import { useState } from 'react';
import type { StaffNotification } from '../api';

/** Bell with unread count and a dropdown inbox. Notifications carry a title and a ticket ID only; opening one loads the ticket through the normal authorized path. */
export function NotificationBell({ items, unread, onOpen, onMarkAllRead }: { items: StaffNotification[]; unread: number; onOpen: (ticketId: string, id: string) => void; onMarkAllRead: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <div className="bell">
    <button className="secondary" aria-haspopup="true" aria-expanded={open} aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen(!open)}>🔔{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}</button>
    {open && <div className="bell-panel" role="region" aria-label="Notifications">
      <div className="row"><strong>Notifications</strong><button className="link" disabled={!unread} onClick={onMarkAllRead}>Mark all read</button></div>
      {items.length ? <ul>{items.map((n) => <li key={n.id} className={n.read ? '' : 'unread'}><button className="link" disabled={!n.ticketId} onClick={() => { if (n.ticketId) onOpen(n.ticketId, n.id); setOpen(false); }}>{n.title}</button><small>{new Date(n.createdAt).toLocaleString()}</small></li>)}</ul> : <p>You are all caught up.</p>}
    </div>}
  </div>;
}
