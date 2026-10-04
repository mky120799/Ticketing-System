import type { FormEvent } from 'react';
import type { TicketListItem } from '../../api';

export function TicketList({ tickets, searchTerm, onSearchTermChange, onSearch, onSelect, hasMore, onLoadMore }: { tickets: TicketListItem[]; searchTerm: string; onSearchTermChange: (value: string) => void; onSearch: (event: FormEvent) => void; onSelect: (id: string) => void; hasMore: boolean; onLoadMore: () => void }): JSX.Element {
  return <section className="tickets"><h2>Authorized tickets</h2>
    <form className="search" onSubmit={onSearch}>
      <label>Search safe metadata<input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Subject, category, status, or queue" /></label>
      <button type="submit">Search</button>
    </form>
    {tickets.map((ticket) => <button className="ticket" key={ticket.id} onClick={() => onSelect(ticket.id)}><strong>{ticket.subject}</strong><span>{ticket.status} · {ticket.queue}</span><small>{ticket.sensitivity} · {ticket.priority}</small></button>)}
    {hasMore && <button className="secondary" onClick={onLoadMore}>Load more tickets</button>}
  </section>;
}
