import { useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { createTicket, type Ticket } from '../../api';

const initialForm = { category: 'service-request', priority: 'normal', sensitivity: 'standard', queue: 'customer-support', branchCode: '', department: '', legalEntity: '', country: '', subject: '', description: '', referenceType: 'customer', sourceSystem: 'CRM', opaqueReference: '' };
const TEXT_FIELDS = ['category', 'queue', 'branchCode', 'department', 'legalEntity', 'country', 'subject', 'sourceSystem', 'opaqueReference'] as const;

/** Staff ticket entry. Customer references are opaque IDs from the source system, never raw account or card numbers. */
export function CreateTicket({ user, onCreated, onError }: { user: User; onCreated: (ticket: Ticket) => void; onError: (message: string) => void }): JSX.Element {
  const [form, setForm] = useState(initialForm);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { referenceType, sourceSystem, opaqueReference, ...ticketFields } = form;
      onCreated(await createTicket(user, { ...ticketFields, references: [{ referenceType, sourceSystem, opaqueReference }], customFields: {} }));
      setForm(initialForm);
    } catch (e) { onError(e instanceof Error ? e.message : 'Unable to create ticket'); }
  };
  const set = (field: keyof typeof initialForm) => (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  return <section className="create"><h2>Create ticket</h2>
    <form onSubmit={(event) => void submit(event)}>
      {TEXT_FIELDS.map((field) => <label key={field}>{field.replace(/([A-Z])/g, ' $1')}<input required value={form[field]} onChange={set(field)} /></label>)}
      <label>priority<select value={form.priority} onChange={set('priority')}>{['low', 'normal', 'high', 'critical'].map((p) => <option key={p}>{p}</option>)}</select></label>
      <label>sensitivity<select value={form.sensitivity} onChange={set('sensitivity')}>{['standard', 'confidential', 'restricted'].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>description<textarea required value={form.description} onChange={set('description')} /></label>
      <button type="submit">Create ticket</button>
    </form></section>;
}
