import { useState } from 'react';
import type { User } from 'oidc-client-ts';
import { addNote, getTicket, IDR_OUTCOMES, PRIVACY_OUTCOMES, ROOT_CAUSES, transitionTicket, type Ticket } from '../../api';

/** Internal notes and status changes. The workflow decides which next states are offered; resolving needs a root cause (and an outcome for complaints). */
export function NotesAndStatus({ user, ticket, onChanged, onStatusChanged, onUpdated, onError }: { user: User; ticket: Ticket; onChanged: () => Promise<void>; onStatusChanged: (id: string, status: string) => void; onUpdated: (ticket: Ticket) => void; onError: (message: string) => void }): JSX.Element {
  const [noteBody, setNoteBody] = useState(''); const [nextStatus, setNextStatus] = useState(''); const [rootCause, setRootCause] = useState(''); const [idrOutcome, setIdrOutcome] = useState('');
  const resolving = nextStatus === 'resolved'; const regulated = Boolean(ticket.regulatory_profile); const outcomes: readonly string[] = ticket.case_kind === 'privacy_request' ? PRIVACY_OUTCOMES : IDR_OUTCOMES; const outcomeLabel = ticket.case_kind === 'privacy_request' ? 'Privacy request outcome (required)' : 'Complaint outcome (required)';
  const saveNote = async () => { if (!noteBody.trim()) return; try { await addNote(user, ticket.id, noteBody.trim()); await onChanged(); setNoteBody(''); } catch (e) { onError(e instanceof Error ? e.message : 'Unable to add note'); } };
  const changeStatus = async () => {
    if (!nextStatus) return;
    try {
      const updated = await transitionTicket(user, ticket.id, nextStatus, `Updated by ${user.profile.preferred_username ?? user.profile.sub}`, resolving ? rootCause : undefined, resolving && regulated ? idrOutcome : undefined, ticket.updatedAt);
      onUpdated(await getTicket(user, updated.id)); onStatusChanged(updated.id, updated.status); setNextStatus(''); setRootCause(''); setIdrOutcome('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Unable to change status');
      if (e instanceof Error && /changed by someone else/.test(e.message)) void onChanged(); // someone else edited it: show their version
    }
  };
  return <div className="activity"><h3>Internal notes</h3>
    {ticket.notes?.map((note) => <article className="note" key={note.id}><p>{note.body}</p><small>{note.authorId} · {new Date(note.createdAt).toLocaleString()}</small></article>)}
    <textarea placeholder="Add an internal note" aria-label="Add an internal note" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} />
    <button onClick={() => void saveNote()}>Add note</button>
    <label>Move status<select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}><option value="">Select next state</option>{(ticket.allowedNextStatuses ?? []).map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></label>
    {resolving && <label>Root cause (required)<select value={rootCause} onChange={(event) => setRootCause(event.target.value)}><option value="">Select root cause</option>{ROOT_CAUSES.map((cause) => <option key={cause} value={cause}>{cause.replace(/_/g, ' ')}</option>)}</select></label>}
    {resolving && regulated && <label>{outcomeLabel}<select value={idrOutcome} onChange={(event) => setIdrOutcome(event.target.value)}><option value="">Select outcome</option>{outcomes.map((outcome) => <option key={outcome} value={outcome}>{outcome.replace(/_/g, ' ')}</option>)}</select></label>}
    <button onClick={() => void changeStatus()} disabled={!nextStatus || (resolving && (!rootCause || (regulated && !idrOutcome)))}>Save status</button>
  </div>;
}
