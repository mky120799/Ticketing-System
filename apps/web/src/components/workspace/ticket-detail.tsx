import type { User } from 'oidc-client-ts';
import type { Ticket } from '../../api';
import { CompliancePanel } from '../compliance-panel';
import { Attachments, AuditTrail, Relationships, SlaAndTimeline } from '../ticket-extras';
import { CommunicationsPanel } from './communications-panel';
import { NotesAndStatus } from './notes-and-status';
import { RetentionPanel } from './retention-panel';

export function TicketDetail({ user, ticket, roles, onChanged, onSelect, onStatusChanged, onUpdated, onError }: { user: User; ticket: Ticket | null; roles: string[]; onChanged: () => Promise<void>; onSelect: (id: string) => void; onStatusChanged: (id: string, status: string) => void; onUpdated: (ticket: Ticket) => void; onError: (message: string) => void }): JSX.Element {
  if (!ticket) return <section className="detail"><h2>Ticket detail</h2><p>Select a ticket to view masked details.</p></section>;
  return <section className="detail"><h2>Ticket detail</h2>
    <h3>{ticket.subject}</h3><p>{ticket.description}</p>
    <dl><dt>Status</dt><dd>{ticket.status}</dd><dt>Queue</dt><dd>{ticket.queue}</dd>
      <dt>References</dt><dd>{ticket.references?.map((reference) => <p key={`${reference.sourceSystem}${reference.maskedValue}`}>{reference.referenceType}: {reference.maskedValue}</p>)}</dd></dl>
    <p className="notice">References are masked. Sensitive reveal is a separately authorized, audited action.</p>
    <SlaAndTimeline ticket={ticket} />
    <CompliancePanel user={user} ticket={ticket} roles={roles} onChanged={onChanged} onError={onError} />
    <Attachments user={user} ticket={ticket} onChanged={onChanged} onError={onError} />
    <Relationships user={user} ticket={ticket} onChanged={onChanged} onError={onError} onOpen={onSelect} />
    {roles.includes('auditor') && <AuditTrail user={user} ticketId={ticket.id} onError={onError} />}
    {roles.includes('supervisor') && <RetentionPanel user={user} ticket={ticket} onChanged={onChanged} onError={onError} />}
    <NotesAndStatus user={user} ticket={ticket} onChanged={onChanged} onStatusChanged={onStatusChanged} onUpdated={onUpdated} onError={onError} />
    <CommunicationsPanel user={user} ticket={ticket} roles={roles} onChanged={onChanged} onError={onError} />
  </section>;
}
