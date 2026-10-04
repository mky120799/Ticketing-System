import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { getBusinessHours, getMessageTemplates, getSlaPolicies, saveBusinessHours, saveMessageTemplate, saveSlaPolicy, type BusinessHours, type MessageTemplate, type SlaPolicy } from '../api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const toMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Response targets, working hours and customer message wording. */
export function AdminSettings({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]); const [hours, setHours] = useState<BusinessHours | null>(null); const [templates, setTemplates] = useState<MessageTemplate[]>([]); const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const fail = (e: unknown) => onError(e instanceof Error ? e.message : 'Request failed');
  const reload = () => { void getSlaPolicies(user).then(setPolicies).catch(fail); void getBusinessHours(user).then(setHours).catch(fail); void getMessageTemplates(user).then(setTemplates).catch(fail); };
  useEffect(reload, [user]);
  const patchPolicy = (index: number, change: Partial<SlaPolicy>) => setPolicies((current) => current.map((p, i) => (i === index ? { ...p, ...change } : p)));
  const savePolicy = async (policy: SlaPolicy) => { try { await saveSlaPolicy(user, policy); reload(); } catch (e) { fail(e); } };
  const submitHours = async (event: FormEvent) => { event.preventDefault(); if (!hours) return; try { await saveBusinessHours(user, hours); reload(); } catch (e) { fail(e); } };
  const submitTemplate = async (event: FormEvent) => { event.preventDefault(); if (!draft) return; try { await saveMessageTemplate(user, draft); setDraft(null); reload(); } catch (e) { fail(e); } };
  const preview = (text: string | null) => (text ?? '').replace(/\{\{ticketRef\}\}/g, 'CASE-1A2B3C4D').replace(/\{\{status\}\}/g, 'being worked on');
  return <>
    <section><h2>SLA policies</h2><p className="notice">Response and resolution targets by priority. <strong>Business hours</strong> counts only working time; <strong>wall clock</strong> counts every minute. Pausing stops the clock while the case waits for the customer.</p>
      {policies.map((p, index) => <form key={`${p.policyKey}${p.priority}`} className="note" onSubmit={(event) => { event.preventDefault(); void savePolicy(p); }}>
        <strong>{p.policyKey} · {p.priority}</strong>
        <label>First response (minutes)<input type="number" min={1} value={p.firstResponseMinutes} onChange={(event) => patchPolicy(index, { firstResponseMinutes: Number(event.target.value) })} /></label>
        <label>Resolution (minutes)<input type="number" min={1} value={p.resolutionMinutes} onChange={(event) => patchPolicy(index, { resolutionMinutes: Number(event.target.value) })} /></label>
        <label>Counts<select value={p.calendar} onChange={(event) => patchPolicy(index, { calendar: event.target.value as 'wall' | 'business' })}><option value="wall">wall clock</option><option value="business">business hours</option></select></label>
        <label><span><input type="checkbox" checked={p.pauseWhilePendingCustomer} onChange={(event) => patchPolicy(index, { pauseWhilePendingCustomer: event.target.checked })} /> Pause while waiting for the customer</span></label>
        <button type="submit">Save {p.priority}</button></form>)}</section>
    <section><h2>Business hours</h2><p className="notice">Used by policies that count business hours, in your country. Public holidays are managed under Public holidays.</p>
      {hours ? <form onSubmit={(event) => void submitHours(event)}>
        <label>Time zone<input required value={hours.timezone} onChange={(event) => setHours({ ...hours, timezone: event.target.value })} placeholder="Australia/Sydney" /></label>
        <label>Opens<input type="time" required value={toTime(hours.startMinute)} onChange={(event) => setHours({ ...hours, startMinute: toMinute(event.target.value) })} /></label>
        <label>Closes<input type="time" required value={toTime(hours.endMinute === 1440 ? 1439 : hours.endMinute)} onChange={(event) => setHours({ ...hours, endMinute: toMinute(event.target.value) })} /></label>
        <fieldset><legend>Working days</legend>{DAYS.map((day, index) => <label key={day} className="inline"><input type="checkbox" checked={hours.workingDays.includes(index)} onChange={(event) => setHours({ ...hours, workingDays: event.target.checked ? [...hours.workingDays, index].sort() : hours.workingDays.filter((d) => d !== index) })} /> {day}</label>)}</fieldset>
        <button type="submit">Save business hours</button></form> : <p>No business hours are set for your country yet.</p>}</section>
    <section><h2>Message templates</h2><p className="notice">Wording of customer messages. Only <code>{'{{ticketRef}}'}</code> and <code>{'{{status}}'}</code> can be used, so a message can never include other case data.</p>
      {templates.map((t) => <article className="note" key={t.templateKey}><strong>{t.templateKey}</strong> {t.active ? '' : '(inactive)'}<p>{t.channel}{t.requiresApproval ? ' · approval required' : ''}</p><p>{t.subjectTemplate ?? 'No wording yet'}</p><button className="secondary" onClick={() => setDraft(t)}>Edit</button></article>)}
      {draft && <form onSubmit={(event) => void submitTemplate(event)}>
        <h3>{draft.templateKey}</h3>
        <label>Subject<input required maxLength={200} value={draft.subjectTemplate ?? ''} onChange={(event) => setDraft({ ...draft, subjectTemplate: event.target.value })} /></label>
        <label>Message<textarea required rows={7} maxLength={5000} value={draft.bodyTemplate ?? ''} onChange={(event) => setDraft({ ...draft, bodyTemplate: event.target.value })} /></label>
        <label className="inline"><input type="checkbox" checked={draft.requiresApproval} onChange={(event) => setDraft({ ...draft, requiresApproval: event.target.checked })} /> Needs a second person's approval</label>
        <label className="inline"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active</label>
        <div className="note" aria-live="polite"><strong>Preview</strong><p>{preview(draft.subjectTemplate)}</p><p className="pre">{preview(draft.bodyTemplate)}</p></div>
        <div className="row"><button type="submit">Save template</button><button type="button" className="secondary" onClick={() => setDraft(null)}>Cancel</button></div></form>}</section>
  </>;
}
