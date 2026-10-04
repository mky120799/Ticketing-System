import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { createCommunication, decideApproval, getCommunicationTemplates, type Ticket } from '../../api';

const DEFAULT_TEMPLATES = [
  { channel: 'email', key: 'ticket_acknowledgement', label: 'Ticket acknowledgement' },
  { channel: 'email', key: 'resolution_notice', label: 'Resolution notice (approval required)' },
  { channel: 'sms', key: 'ticket_status_sms', label: 'Ticket status SMS' },
  { channel: 'portal', key: 'portal_update', label: 'Portal update' }
];

/** Governed customer communications: approved templates only, masked recipients, and a second person approves where required. */
export function CommunicationsPanel({ user, ticket, roles, onChanged, onError }: { user: User; ticket: Ticket; roles: string[]; onChanged: () => Promise<void>; onError: (message: string) => void }): JSX.Element {
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES); const [form, setForm] = useState({ template: 'email:ticket_acknowledgement', recipientReference: '' });
  useEffect(() => { void getCommunicationTemplates(user).then((list) => setTemplates(list.map((t) => ({ channel: t.channel, key: t.templateKey, label: `${t.templateKey.replace(/[-_]/g, ' ')}${t.requiresApproval ? ' (approval required)' : ''}` })))).catch((e: Error) => onError(e.message)); }, [user, onError]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!form.recipientReference.trim()) return;
    try { const [channel, templateKey] = form.template.split(':'); await createCommunication(user, ticket.id, { channel, templateKey, recipientReference: form.recipientReference.trim() }); await onChanged(); setForm({ ...form, recipientReference: '' }); }
    catch (e) { onError(e instanceof Error ? e.message : 'Unable to queue communication'); }
  };
  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => { try { await decideApproval(user, ticket.id, approvalId, decision); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : 'Unable to decide communication approval'); } };
  return <div className="activity"><h3>Customer communications</h3>
    {ticket.communications?.length ? ticket.communications.map((entry) => <article className="communication" key={entry.id}>
      <div><strong>{entry.templateKey}</strong><span>{entry.channel} · {entry.status}</span><small>Recipient: {entry.recipientMasked}</small></div>
      {entry.status === 'pending_approval' && entry.approvalId && roles.includes('supervisor') && <div className="communication-actions"><button onClick={() => void decide(entry.approvalId!, 'approved')}>Approve</button><button className="secondary" onClick={() => void decide(entry.approvalId!, 'rejected')}>Reject</button></div>}
    </article>) : <p>No customer communications recorded.</p>}
    <form onSubmit={(event) => void submit(event)}>
      <label>Template<select value={form.template} onChange={(event) => setForm({ ...form, template: event.target.value })}>{templates.map((t) => <option key={`${t.channel}:${t.key}`} value={`${t.channel}:${t.key}`}>{t.label}</option>)}</select></label>
      <label>Recipient reference<input required minLength={8} value={form.recipientReference} onChange={(event) => setForm({ ...form, recipientReference: event.target.value })} placeholder="Opaque recipient reference" /></label>
      <button type="submit">Queue communication</button>
    </form>
    <p className="notice">Only the masked recipient is displayed after submission. Approval-gated templates cannot be delivered until an independent supervisor approves them.</p>
  </div>;
}
