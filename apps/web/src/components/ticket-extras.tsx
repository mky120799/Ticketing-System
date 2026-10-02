import { useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { exportAuditTrail, getAttachmentDownload, getAuditTrail, linkTicket, uploadAttachment, type AuditEvent, type Ticket } from '../api';

const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');

/** SLA state and the ticket's status/escalation timeline. */
export function SlaAndTimeline({ ticket }: { ticket: Ticket }): JSX.Element {
  return <div className="activity">
    <h3>SLA</h3>
    <p><span className={`chip sla-${ticket.slaStatus ?? 'running'}`}>{(ticket.slaStatus ?? 'running').replace(/_/g, ' ')}</span> {ticket.assigned_to ? `Assigned to ${ticket.assigned_to}` : 'Unassigned'}</p>
    <small>First response due {when(ticket.firstResponseDueAt)} · Resolution due {when(ticket.resolutionDueAt)}</small>
    <h3>Timeline</h3>
    {ticket.history?.length ? <ol className="timeline">{ticket.history.map((entry, index) => <li key={index} className={entry.toStatus === 'escalated' ? 'escalated' : ''}><strong>{entry.fromStatus ? `${entry.fromStatus} → ` : ''}{entry.toStatus}</strong><span>{entry.reason}</span><small>{entry.changedBy.startsWith('system:') ? `Automatic (${entry.changedBy.slice(7)})` : entry.changedBy} · {when(entry.changedAt)}</small></li>)}</ol> : <p>No status changes yet.</p>}
  </div>;
}

/** Attachment list, upload (checksummed, direct to object storage) and gated download. */
export function Attachments({ user, ticket, onChanged, onError }: { user: User; ticket: Ticket; onChanged: () => Promise<void>; onError: (message: string) => void }): JSX.Element {
  const [classification, setClassification] = useState<'confidential' | 'restricted'>('confidential'); const [note, setNote] = useState('');
  const upload = async (file: File | undefined) => {
    if (!file) return; setNote('');
    try { const result = await uploadAttachment(user, ticket.id, file, classification); setNote(result.stored ? 'Uploaded. Content stays unavailable until malware scanning completes.' : 'Metadata recorded. Object storage is not configured, so no file bytes were stored.'); await onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : 'Unable to upload attachment'); }
  };
  const download = async (id: string) => {
    try { const result = await getAttachmentDownload(user, ticket.id, id); if (result.downloadUrl) window.open(result.downloadUrl, '_blank', 'noopener'); else onError('Object storage is not configured.'); }
    catch (e) { onError(e instanceof Error ? e.message : 'Download is not available'); }
  };
  return <div className="activity">
    <h3>Attachments</h3>
    {ticket.attachments?.length ? ticket.attachments.map((file) => <article className="communication" key={file.id}><div><strong>{file.filename}</strong><span>{file.classification} · {Math.ceil(file.sizeBytes / 1024)} KB · {file.malwareStatus.replace(/_/g, ' ')}</span></div>{file.malwareStatus === 'clean' && <button className="secondary" onClick={() => void download(file.id)}>Download</button>}</article>) : <p>No attachments.</p>}
    <label>Classification<select value={classification} onChange={(event) => setClassification(event.target.value as 'confidential' | 'restricted')}><option value="confidential">confidential</option><option value="restricted">restricted (supervisor)</option></select></label>
    <label>Add file (PDF, JPEG, PNG or text, up to 25 MB)<input type="file" accept="application/pdf,image/jpeg,image/png,text/plain" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {note && <p className="notice">{note}</p>}
  </div>;
}

/** Related-ticket links (opaque IDs only) and a form to create one. */
export function Relationships({ user, ticket, onChanged, onError, onOpen }: { user: User; ticket: Ticket; onChanged: () => Promise<void>; onError: (message: string) => void; onOpen: (id: string) => void }): JSX.Element {
  const [target, setTarget] = useState(''); const [type, setType] = useState('related_to');
  const submit = async (event: FormEvent) => { event.preventDefault(); try { await linkTicket(user, ticket.id, target.trim(), type); setTarget(''); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : 'Unable to link ticket'); } };
  return <div className="activity">
    <h3>Related tickets</h3>
    {ticket.relatedTickets?.length ? ticket.relatedTickets.map((link) => <p key={`${link.ticketId}${link.relationshipType}${link.direction}`}>{link.direction === 'outgoing' ? link.relationshipType.replace(/_/g, ' ') : `target of ${link.relationshipType.replace(/_/g, ' ')}`}: <button className="link" onClick={() => onOpen(link.ticketId)}>{link.ticketId.slice(0, 8)}…</button></p>) : <p>No linked tickets.</p>}
    <form onSubmit={(event) => void submit(event)}>
      <label>Ticket ID<input required pattern="[0-9a-fA-F-]{36}" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Full ticket ID to link" /></label>
      <label>Relationship<select value={type} onChange={(event) => setType(event.target.value)}><option value="related_to">related to</option><option value="duplicate_of">duplicate of</option><option value="parent_of">parent of</option></select></label>
      <button type="submit">Link ticket</button>
    </form>
  </div>;
}

/** Immutable, hash-chained audit trail for the selected ticket (auditor role). Viewing and exporting are themselves audited. */
export function AuditTrail({ user, ticketId, onError }: { user: User; ticketId: string; onError: (message: string) => void }): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const load = async () => { try { setEvents((await getAuditTrail(user, ticketId)).events); } catch (e) { onError(e instanceof Error ? e.message : 'Unable to load audit trail'); } };
  const exportJson = async () => {
    try { const report = await exportAuditTrail(user, ticketId); const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `audit-${ticketId}.json`; link.click(); URL.revokeObjectURL(url); }
    catch (e) { onError(e instanceof Error ? e.message : 'Unable to export audit trail'); }
  };
  return <div className="activity">
    <h3>Audit trail</h3>
    <div className="row"><button onClick={() => void load()}>{events ? 'Refresh' : 'Load audit trail'}</button><button className="secondary" onClick={() => void exportJson()}>Export JSON</button></div>
    {events && (events.length ? <ol className="timeline">{events.map((event) => <li key={event.id}><strong>{event.action}</strong><span>{event.outcome} · actor {event.actorId}</span><small>{when(event.occurredAt)} · hash {event.eventHash.slice(0, 12)}… ← {event.previousHash ? `${event.previousHash.slice(0, 12)}…` : 'start'}</small></li>)}</ol> : <p>No audit events.</p>)}
  </div>;
}
