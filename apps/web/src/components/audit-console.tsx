import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { getChainStatus, searchAudit, verifyChain, type AuditSearchEvent, type ChainStatus } from '../api';

/** Auditor console: integrity of the whole audit trail, plus search across tickets in the auditor's scope. */
export function AuditConsole({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [status, setStatus] = useState<ChainStatus | null>(null); const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ actor: '', action: '', outcome: '', from: '', to: '' });
  const [events, setEvents] = useState<AuditSearchEvent[]>([]); const [next, setNext] = useState<number | null>(null); const [searched, setSearched] = useState(false);
  const fail = (e: unknown) => onError(e instanceof Error ? e.message : 'Request failed');
  const reload = () => { void getChainStatus(user).then(setStatus).catch(fail); };
  useEffect(reload, [user]);
  const verify = async (full: boolean) => { setBusy(true); try { await verifyChain(user, full); reload(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const run = async (before?: number) => {
    try {
      const result = await searchAudit(user, { ...filters, from: filters.from ? new Date(filters.from).toISOString() : undefined, to: filters.to ? new Date(filters.to).toISOString() : undefined, before });
      setEvents((current) => (before ? [...current, ...result.events] : result.events)); setNext(result.nextBefore); setSearched(true);
    } catch (e) { fail(e); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void run(); };
  const v = status?.verification;
  return <div className="admin-grid">
    <section><h2>Audit trail integrity</h2>
      {v ? <>
        <p><span className={`chip ${v.status === 'valid' ? 'reg-met' : 'reg-final_response_overdue'}`}>{v.status === 'valid' ? 'Chain verified' : 'INTEGRITY FAILURE'}</span></p>
        <small>Verified through event {v.verifiedThroughSequence} · {v.eventsChecked} checked in last run{v.legacyEvents ? ` · ${v.legacyEvents} older events link-checked only` : ''} · {new Date(v.verifiedAt).toLocaleString()}</small>
        {v.status === 'invalid' && <p className="error">Sequence {v.failureSequence}: {v.failureReason}. Escalate to security immediately; do not modify the database.</p>}
      </> : <p>No verification has run yet.</p>}
      <small>{status?.lastAnchor ? `Last published anchor: event ${status.lastAnchor.sequence} at ${new Date(status.lastAnchor.createdAt).toLocaleString()} (hash ${status.lastAnchor.headHash.slice(0, 16)}…)` : 'No anchor published yet.'}</small>
      <div className="row"><button disabled={busy} onClick={() => void verify(false)}>Verify new events</button><button className="secondary" disabled={busy} onClick={() => void verify(true)}>Full re-verification</button></div>
      <p className="notice">Incremental runs check events added since the last clean run. A full run re-checks every event and detects changes to older history.</p></section>
    <section style={{ gridColumn: 'span 2' }}><h2>Search audit events</h2>
      <form onSubmit={submit} className="row">
        <label>Actor<input value={filters.actor} onChange={(event) => setFilters({ ...filters, actor: event.target.value })} placeholder="User or system ID" /></label>
        <label>Action starts with<input value={filters.action} onChange={(event) => setFilters({ ...filters, action: event.target.value })} placeholder="ticket.status" /></label>
        <label>Outcome<select value={filters.outcome} onChange={(event) => setFilters({ ...filters, outcome: event.target.value })}><option value="">any</option><option value="success">success</option><option value="denied">denied</option></select></label>
        <label>From<input type="datetime-local" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label>To<input type="datetime-local" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <button type="submit">Search</button></form>
      {searched && (events.length ? <table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{new Date(event.occurredAt).toLocaleString()}</td><td>{event.actorId}</td><td>{event.action}</td><td>{event.targetType} {event.targetId.slice(0, 8)}</td><td className={event.outcome === 'denied' ? 'bad' : ''}>{event.outcome}</td></tr>)}</tbody></table> : <p>No matching events.</p>)}
      {next !== null && <button className="secondary" onClick={() => void run(next)}>Load more</button>}
      <p className="notice">Search covers events about tickets in your entity, country and queues. Restricted-sensitivity tickets need supervisor entitlement and are excluded. Every search is itself audited.</p></section>
  </div>;
}
