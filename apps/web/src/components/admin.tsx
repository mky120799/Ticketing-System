import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { getWorkflows, saveWorkflow, type WorkflowDefinition } from '../api';
import { getHolidays, getRegulatoryProfiles, saveHoliday, saveRegulatoryProfile, type Holiday, type RegulatoryProfile } from '../api';
import { getAssignmentRules, getCategories, getEscalationRules, getIntakeChannels, getQueueMembers, getQueues, saveAssignmentRule, saveEscalationRule, saveIntakeChannel, saveQueueMember, type AssignmentRule, type EscalationRule, type IntakeChannel, type QueueMember } from '../api';

/** Administrator routing configuration: who receives work, how it is chosen, and where overdue work goes. */
export function Admin({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [queues, setQueues] = useState<string[]>([]); const [categories, setCategories] = useState<string[]>([]);
  const [queue, setQueue] = useState(''); const [members, setMembers] = useState<QueueMember[]>([]); const [memberId, setMemberId] = useState('');
  const [assignment, setAssignment] = useState<AssignmentRule[]>([]); const [escalation, setEscalation] = useState<EscalationRule[]>([]);
  const [rule, setRule] = useState<AssignmentRule>({ ruleKey: '', queue: '', category: null, priority: null, strategy: 'least_loaded', sortOrder: 100, active: true });
  const [esc, setEsc] = useState<EscalationRule>({ ruleKey: '', queue: '', trigger: 'first_response_overdue', escalateToQueue: '', raisePriority: true, active: true });
  const [channels, setChannels] = useState<IntakeChannel[]>([]); const [channel, setChannel] = useState<IntakeChannel>({ channel: 'email', defaultCategory: '', defaultQueue: '', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true });
  const [profiles, setProfiles] = useState<RegulatoryProfile[]>([]); const [holidays, setHolidays] = useState<Holiday[]>([]); const [holiday, setHoliday] = useState<Holiday>({ date: '', name: ''});
  const [profile, setProfile] = useState<RegulatoryProfile>({ profileKey: '', label: '', jurisdiction: 'AU', acknowledgeBusinessDays: 1, finalResponseCalendarDays: 30, atRiskDays: 5, active: true });
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]); const [workflowKey, setWorkflowKey] = useState(''); const [workflowJson, setWorkflowJson] = useState('');
  const fail = (e: unknown) => onError(e instanceof Error ? e.message : 'Request failed');
  const reloadRules = () => { void getAssignmentRules(user).then(setAssignment).catch(fail); void getEscalationRules(user).then(setEscalation).catch(fail); void getIntakeChannels(user).then(setChannels).catch(fail); void getRegulatoryProfiles(user).then(setProfiles).catch(fail); void getHolidays(user).then(setHolidays).catch(fail); void getWorkflows(user).then(setWorkflows).catch(fail); };
  const reloadMembers = (key: string) => { if (key) void getQueueMembers(user, key).then(setMembers).catch(fail); else setMembers([]); };
  useEffect(() => {
    void getQueues(user).then((list) => { const keys = list.map((entry) => entry.queue); setQueues(keys); setQueue(keys[0] ?? ''); setRule((current) => ({ ...current, queue: keys[0] ?? '' })); setEsc((current) => ({ ...current, queue: keys[0] ?? '', escalateToQueue: keys[1] ?? '' })); setChannel((current) => ({ ...current, defaultQueue: keys[0] ?? '' })); }).catch(fail);
    void getCategories(user).then((list) => { setCategories(list.map((entry) => entry.category)); setChannel((current) => ({ ...current, defaultCategory: list[0]?.category ?? '' })); }).catch(fail); reloadRules();
  }, [user]);
  useEffect(() => reloadMembers(queue), [queue]);
  const addMember = async (event: FormEvent) => { event.preventDefault(); try { await saveQueueMember(user, queue, memberId.trim(), true); setMemberId(''); reloadMembers(queue); } catch (e) { fail(e); } };
  const toggleMember = async (member: QueueMember) => { try { await saveQueueMember(user, queue, member.userId, !member.active); reloadMembers(queue); } catch (e) { fail(e); } };
  const submitRule = async (event: FormEvent) => { event.preventDefault(); try { await saveAssignmentRule(user, rule); reloadRules(); } catch (e) { fail(e); } };
  const submitEsc = async (event: FormEvent) => { event.preventDefault(); try { await saveEscalationRule(user, esc); reloadRules(); } catch (e) { fail(e); } };
  const submitChannel = async (event: FormEvent) => { event.preventDefault(); try { await saveIntakeChannel(user, channel); reloadRules(); } catch (e) { fail(e); } };
  const submitProfile = async (event: FormEvent) => { event.preventDefault(); try { await saveRegulatoryProfile(user, profile); reloadRules(); } catch (e) { fail(e); } };
  const submitHoliday = async (event: FormEvent) => { event.preventDefault(); try { await saveHoliday(user, holiday); setHoliday({ date: '', name: '' }); reloadRules(); } catch (e) { fail(e); } };
  const editWorkflow = (item: WorkflowDefinition) => { setWorkflowKey(item.workflowKey); setWorkflowJson(JSON.stringify({ label: item.label, active: item.active, transitions: item.transitions }, null, 2)); };
  const submitWorkflow = async (event: FormEvent) => { event.preventDefault(); try { const body = JSON.parse(workflowJson) as Omit<WorkflowDefinition, 'workflowKey'>; await saveWorkflow(user, { workflowKey, ...body }); reloadRules(); } catch (e) { fail(e); } };
  const options = (values: string[]) => values.map((value) => <option key={value} value={value}>{value}</option>);
  return <div className="admin-grid">
    <section><h2>Queue members</h2><p className="notice">Members are auto-assignment candidates. Enter the person's identity-provider subject ID.</p>
      <label>Queue<select value={queue} onChange={(event) => setQueue(event.target.value)}>{options(queues)}</select></label>
      {members.map((member) => <article className="communication" key={member.userId}><div><strong>{member.userId}</strong><span>{member.active ? 'active' : 'inactive'}</span></div><button className="secondary" onClick={() => void toggleMember(member)}>{member.active ? 'Deactivate' : 'Activate'}</button></article>)}
      <form onSubmit={(event) => void addMember(event)}><label>Add member<input required value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="Subject ID" /></label><button type="submit">Add to queue</button></form></section>
    <section><h2>Assignment rules</h2>
      {assignment.map((item) => <article className="note" key={item.ruleKey}><strong>{item.ruleKey}</strong> {item.active ? '' : '(inactive)'}<p>{item.queue} · {item.category ?? 'any category'} · {item.priority ?? 'any priority'} · {item.strategy.replace('_', ' ')} · order {item.sortOrder}</p><button className="secondary" onClick={() => setRule(item)}>Edit</button></article>)}
      <form onSubmit={(event) => void submitRule(event)}>
        <label>Rule key<input required pattern="[a-z0-9][a-z0-9-]+" value={rule.ruleKey} onChange={(event) => setRule({ ...rule, ruleKey: event.target.value })} /></label>
        <label>Queue<select value={rule.queue} onChange={(event) => setRule({ ...rule, queue: event.target.value })}>{options(queues)}</select></label>
        <label>Category<select value={rule.category ?? ''} onChange={(event) => setRule({ ...rule, category: event.target.value || null })}><option value="">any</option>{options(categories)}</select></label>
        <label>Priority<select value={rule.priority ?? ''} onChange={(event) => setRule({ ...rule, priority: event.target.value || null })}><option value="">any</option>{options(['low', 'normal', 'high', 'critical'])}</select></label>
        <label>Strategy<select value={rule.strategy} onChange={(event) => setRule({ ...rule, strategy: event.target.value })}><option value="least_loaded">least loaded</option><option value="round_robin">round robin</option></select></label>
        <label>Order<input type="number" min={1} max={10000} value={rule.sortOrder} onChange={(event) => setRule({ ...rule, sortOrder: Number(event.target.value) })} /></label>
        <label><span><input type="checkbox" checked={rule.active} onChange={(event) => setRule({ ...rule, active: event.target.checked })} /> Active</span></label>
        <button type="submit">Save rule</button></form></section>
    <section><h2>Escalation rules</h2>
      {escalation.map((item) => <article className="note" key={item.ruleKey}><strong>{item.ruleKey}</strong> {item.active ? '' : '(inactive)'}<p>{item.queue} → {item.escalateToQueue} on {item.trigger.replace(/_/g, ' ')}{item.raisePriority ? ' · raises priority' : ''}</p><button className="secondary" onClick={() => setEsc(item)}>Edit</button></article>)}
      <form onSubmit={(event) => void submitEsc(event)}>
        <label>Rule key<input required pattern="[a-z0-9][a-z0-9-]+" value={esc.ruleKey} onChange={(event) => setEsc({ ...esc, ruleKey: event.target.value })} /></label>
        <label>From queue<select value={esc.queue} onChange={(event) => setEsc({ ...esc, queue: event.target.value })}>{options(queues)}</select></label>
        <label>Trigger<select value={esc.trigger} onChange={(event) => setEsc({ ...esc, trigger: event.target.value })}><option value="first_response_overdue">first response overdue</option><option value="breached">resolution breached</option></select></label>
        <label>Escalate to<select value={esc.escalateToQueue} onChange={(event) => setEsc({ ...esc, escalateToQueue: event.target.value })}>{options(queues)}</select></label>
        <label><span><input type="checkbox" checked={esc.raisePriority} onChange={(event) => setEsc({ ...esc, raisePriority: event.target.checked })} /> Raise priority one step</span></label>
        <label><span><input type="checkbox" checked={esc.active} onChange={(event) => setEsc({ ...esc, active: event.target.checked })} /> Active</span></label>
        <button type="submit">Save rule</button></form></section>
      <section><h2>Intake channels</h2><p className="notice">Defaults for tickets that arrive without a staff member. Channel adapters authenticate as the intake-gateway service identity.</p>
      {channels.map((item) => <article className="note" key={item.channel}><strong>{item.channel}</strong> {item.active ? '' : '(inactive)'}<p>{item.defaultCategory} → {item.defaultQueue} · branch {item.branchCode} · {item.defaultPriority}</p><button className="secondary" onClick={() => setChannel(item)}>Edit</button></article>)}
      <form onSubmit={(event) => void submitChannel(event)}>
        <label>Channel<select value={channel.channel} onChange={(event) => setChannel({ ...channel, channel: event.target.value })}>{options(['email', 'portal', 'mobile', 'phone', 'internal'])}</select></label>
        <label>Default category<select value={channel.defaultCategory} onChange={(event) => setChannel({ ...channel, defaultCategory: event.target.value })}>{options(categories)}</select></label>
        <label>Default queue<select value={channel.defaultQueue} onChange={(event) => setChannel({ ...channel, defaultQueue: event.target.value })}>{options(queues)}</select></label>
        <label>Branch code<input required value={channel.branchCode} onChange={(event) => setChannel({ ...channel, branchCode: event.target.value })} /></label>
        <label>Default priority<select value={channel.defaultPriority} onChange={(event) => setChannel({ ...channel, defaultPriority: event.target.value })}>{options(['low', 'normal', 'high', 'critical'])}</select></label>
        <label><span><input type="checkbox" checked={channel.active} onChange={(event) => setChannel({ ...channel, active: event.target.checked })} /> Active</span></label>
        <button type="submit">Save channel</button></form></section>
      <section><h2>Regulatory profiles</h2><p className="notice">Jurisdiction rules are configuration. A category linked to a profile makes its tickets complaints with these clocks (for example Australian RG 271: acknowledge in 1 business day, final response in 30 days).</p>
      {profiles.map((item) => <article className="note" key={item.profileKey}><strong>{item.profileKey}</strong> {item.active ? '' : '(inactive)'}<p>{item.label}</p><p>Acknowledge {item.acknowledgeBusinessDays} business day(s) · final response {item.finalResponseCalendarDays} days · at risk in last {item.atRiskDays} days</p><button className="secondary" onClick={() => setProfile(item)}>Edit</button></article>)}
      <form onSubmit={(event) => void submitProfile(event)}>
        <label>Profile key<input required pattern="[a-z0-9][a-z0-9-]+" value={profile.profileKey} onChange={(event) => setProfile({ ...profile, profileKey: event.target.value })} /></label>
        <label>Label<input required value={profile.label} onChange={(event) => setProfile({ ...profile, label: event.target.value })} /></label>
        <label>Jurisdiction<input required maxLength={2} value={profile.jurisdiction} onChange={(event) => setProfile({ ...profile, jurisdiction: event.target.value.toUpperCase() })} /></label>
        <label>Acknowledge within (business days)<input type="number" min={0} max={30} value={profile.acknowledgeBusinessDays} onChange={(event) => setProfile({ ...profile, acknowledgeBusinessDays: Number(event.target.value) })} /></label>
        <label>Final response within (calendar days)<input type="number" min={1} max={365} value={profile.finalResponseCalendarDays} onChange={(event) => setProfile({ ...profile, finalResponseCalendarDays: Number(event.target.value) })} /></label>
        <label>At-risk window (days before due)<input type="number" min={0} max={60} value={profile.atRiskDays} onChange={(event) => setProfile({ ...profile, atRiskDays: Number(event.target.value) })} /></label>
        <label><span><input type="checkbox" checked={profile.active} onChange={(event) => setProfile({ ...profile, active: event.target.checked })} /> Active</span></label>
        <button type="submit">Save profile</button></form></section>
    <section><h2>Public holidays</h2><p className="notice">Used to calculate business-day deadlines. Weekends are always excluded.</p>
      {holidays.map((item) => <p key={item.date}>{item.date} · {item.name}</p>)}
      <form onSubmit={(event) => void submitHoliday(event)}>
        <label>Date<input type="date" required value={holiday.date} onChange={(event) => setHoliday({ ...holiday, date: event.target.value })} /></label>
        <label>Name<input required value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} /></label>
        <button type="submit">Save holiday</button></form></section>
      <section><h2>Workflows</h2><p className="notice">Ticket lifecycles. A category uses one workflow; each transition may be limited to roles. A definition is rejected if a status cannot reach closed or cancelled.</p>
      {workflows.map((item) => <article className="note" key={item.workflowKey}><strong>{item.workflowKey}</strong> {item.active ? '' : '(inactive)'}<p>{item.label} · {item.transitions.length} transitions</p><button className="secondary" onClick={() => editWorkflow(item)}>Edit</button></article>)}
      <form onSubmit={(event) => void submitWorkflow(event)}>
        <label>Workflow key<input required pattern="[a-z0-9][a-z0-9-]+" value={workflowKey} onChange={(event) => setWorkflowKey(event.target.value)} /></label>
        <label>Definition (JSON)<textarea required rows={10} value={workflowJson} onChange={(event) => setWorkflowJson(event.target.value)} placeholder='{"label":"…","active":true,"transitions":[{"from":"submitted","to":"triage"}]}' /></label>
        <button type="submit">Save workflow</button></form></section>
  </div>;
}
