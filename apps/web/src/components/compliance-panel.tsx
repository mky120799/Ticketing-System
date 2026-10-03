import { useState } from 'react';
import type { User } from 'oidc-client-ts';
import { classifyComplaint, getRegulatoryProfiles, setCommunicationBlock, updateAfca, type RegulatoryProfile, type Ticket } from '../api';

const when = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');
const LABELS: Record<string, string> = { on_track: 'on track', at_risk: 'at risk', ack_overdue: 'acknowledgement overdue', final_response_overdue: 'final response overdue', met: 'met' };

/** Complaint classification, regulatory clock, vulnerability, external dispute scheme and communication block. */
export function CompliancePanel({ user, ticket, roles, onChanged, onError }: { user: User; ticket: Ticket; roles: string[]; onChanged: () => Promise<void>; onError: (message: string) => void }): JSX.Element {
  const [profiles, setProfiles] = useState<RegulatoryProfile[]>([]); const [profile, setProfile] = useState(''); const [afcaRef, setAfcaRef] = useState('');
  const supervisor = roles.includes('supervisor');
  const run = async (action: () => Promise<unknown>) => { try { await action(); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : 'Request failed'); } };
  const loadProfiles = () => { void getRegulatoryProfiles(user).then((list) => { setProfiles(list); setProfile(list[0]?.profileKey ?? ''); }).catch(() => undefined); };
  const status = ticket.regulatory_status ?? 'on_track';
  return <div className="activity">
    <h3>Complaint and compliance</h3>
    {ticket.is_complaint ? <>
      <p><span className={`chip reg-${status}`}>{LABELS[status] ?? status}</span> {ticket.vulnerability_flag && <span className="chip reg-at_risk">vulnerable customer</span>} {ticket.systemic_issue && <span className="chip reg-at_risk">systemic issue</span>}</p>
      <small>Profile {ticket.regulatory_profile} · Acknowledge by {when(ticket.acknowledge_due_at)} · Final response by {when(ticket.final_response_due_at)}{ticket.idr_outcome ? ` · Outcome: ${ticket.idr_outcome.replace(/_/g, ' ')}` : ''}</small>
      <div className="row">
        <button className="secondary" onClick={() => void run(() => classifyComplaint(user, ticket.id, { isComplaint: true, profileKey: ticket.regulatory_profile ?? undefined, vulnerabilityFlag: !ticket.vulnerability_flag, reason: 'Vulnerability flag changed' }))}>{ticket.vulnerability_flag ? 'Clear vulnerable flag' : 'Flag vulnerable customer'}</button>
        <button className="secondary" onClick={() => void run(() => classifyComplaint(user, ticket.id, { isComplaint: true, profileKey: ticket.regulatory_profile ?? undefined, systemicIssue: !ticket.systemic_issue, reason: 'Systemic issue flag changed' }))}>{ticket.systemic_issue ? 'Clear systemic flag' : 'Flag systemic issue'}</button>
      </div>
      {supervisor && <div className="row"><small>External dispute scheme: {ticket.afca_status ?? 'none'}{ticket.afca_reference ? ` (${ticket.afca_reference})` : ''}</small>
        <input aria-label="External scheme reference" value={afcaRef} onChange={(event) => setAfcaRef(event.target.value)} placeholder="Reference" />
        <button className="secondary" onClick={() => void run(() => updateAfca(user, ticket.id, 'referred', afcaRef.trim() || undefined))}>Record referral</button></div>}
    </> : <>
      <p>Not classified as a complaint.</p>
      <div className="row"><select aria-label="Regulatory profile" value={profile} onFocus={loadProfiles} onChange={(event) => setProfile(event.target.value)}>{profiles.length ? profiles.map((item) => <option key={item.profileKey} value={item.profileKey}>{item.label}</option>) : <option value="">Load profiles…</option>}</select>
        <button disabled={!profile} onClick={() => void run(() => classifyComplaint(user, ticket.id, { isComplaint: true, profileKey: profile, reason: 'Customer expressed dissatisfaction' }))}>Mark as complaint</button></div>
    </>}
    {supervisor && <div className="row"><small>Customer communications: {ticket.communications_blocked ? 'BLOCKED' : 'allowed'}</small>
      <button className="secondary" onClick={() => void run(() => setCommunicationBlock(user, ticket.id, !ticket.communications_blocked, ticket.communications_blocked ? 'Block lifted by supervisor' : 'Blocked by supervisor'))}>{ticket.communications_blocked ? 'Lift block' : 'Block customer communications'}</button></div>}
  </div>;
}
