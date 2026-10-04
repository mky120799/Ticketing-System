import { useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { updateRetention, type Ticket } from '../../api';

/** Supervisors place or lift a legal hold and set a retention date. A hold needs a reason, which stays out of integration events. */
export function RetentionPanel({ user, ticket, onChanged, onError }: { user: User; ticket: Ticket; onChanged: () => Promise<void>; onError: (message: string) => void }): JSX.Element {
  const [retention, setRetention] = useState({ legalHold: false, retentionUntil: '', holdReason: '' });
  useEffect(() => { setRetention({ legalHold: ticket.retention?.legalHold ?? false, retentionUntil: ticket.retention?.retentionUntil ? ticket.retention.retentionUntil.slice(0, 16) : '', holdReason: '' }); }, [ticket]);
  const save = async () => {
    try {
      await updateRetention(user, ticket.id, { legalHold: retention.legalHold, ...(retention.retentionUntil ? { retentionUntil: new Date(retention.retentionUntil).toISOString() } : {}), ...(retention.holdReason.trim() ? { holdReason: retention.holdReason.trim() } : {}) });
      await onChanged(); setRetention((current) => ({ ...current, holdReason: '' }));
    } catch (e) { onError(e instanceof Error ? e.message : 'Unable to update retention control'); }
  };
  return <div className="activity"><h3>Retention and legal hold</h3>
    <label><span><input type="checkbox" checked={retention.legalHold} onChange={(event) => setRetention({ ...retention, legalHold: event.target.checked })} /> Legal hold enabled</span></label>
    <label>Retention until<input type="datetime-local" value={retention.retentionUntil} onChange={(event) => setRetention({ ...retention, retentionUntil: event.target.value })} /></label>
    <label>Hold reason<textarea minLength={3} value={retention.holdReason} onChange={(event) => setRetention({ ...retention, holdReason: event.target.value })} placeholder="Required when enabling a hold" /></label>
    <button onClick={() => void save()}>Save retention control</button>
    <small>Current state: {ticket.retention?.legalHold ? 'legal hold enabled' : 'no legal hold'}{ticket.retention?.retentionUntil ? ` · until ${new Date(ticket.retention.retentionUntil).toLocaleString()}` : ''}</small>
  </div>;
}
