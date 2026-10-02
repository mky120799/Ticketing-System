import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { getAssignmentRules, getCategories, getEscalationRules, getQueueMembers, getQueues, saveAssignmentRule, saveEscalationRule, saveQueueMember, type AssignmentRule, type EscalationRule, type QueueMember } from '../api';

/** Administrator routing configuration: who receives work, how it is chosen, and where overdue work goes. */
export function Admin({ user, onError }: { user: User; onError: (message: string) => void }): JSX.Element {
  const [queues, setQueues] = useState<string[]>([]); const [categories, setCategories] = useState<string[]>([]);
  const [queue, setQueue] = useState(''); const [members, setMembers] = useState<QueueMember[]>([]); const [memberId, setMemberId] = useState('');
  const [assignment, setAssignment] = useState<AssignmentRule[]>([]); const [escalation, setEscalation] = useState<EscalationRule[]>([]);
  const [rule, setRule] = useState<AssignmentRule>({ ruleKey: '', queue: '', category: null, priority: null, strategy: 'least_loaded', sortOrder: 100, active: true });
  const [esc, setEsc] = useState<EscalationRule>({ ruleKey: '', queue: '', trigger: 'first_response_overdue', escalateToQueue: '', raisePriority: true, active: true });
  const fail = (e: unknown) => onError(e instanceof Error ? e.message : 'Request failed');
  const reloadRules = () => { void getAssignmentRules(user).then(setAssignment).catch(fail); void getEscalationRules(user).then(setEscalation).catch(fail); };
  const reloadMembers = (key: string) => { if (key) void getQueueMembers(user, key).then(setMembers).catch(fail); else setMembers([]); };
  useEffect(() => {
    void getQueues(user).then((list) => { const keys = list.map((entry) => entry.queue); setQueues(keys); setQueue(keys[0] ?? ''); setRule((current) => ({ ...current, queue: keys[0] ?? '' })); setEsc((current) => ({ ...current, queue: keys[0] ?? '', escalateToQueue: keys[1] ?? '' })); }).catch(fail);
    void getCategories(user).then((list) => setCategories(list.map((entry) => entry.category))).catch(fail); reloadRules();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => reloadMembers(queue), [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const addMember = async (event: FormEvent) => { event.preventDefault(); try { await saveQueueMember(user, queue, memberId.trim(), true); setMemberId(''); reloadMembers(queue); } catch (e) { fail(e); } };
  const toggleMember = async (member: QueueMember) => { try { await saveQueueMember(user, queue, member.userId, !member.active); reloadMembers(queue); } catch (e) { fail(e); } };
  const submitRule = async (event: FormEvent) => { event.preventDefault(); try { await saveAssignmentRule(user, rule); reloadRules(); } catch (e) { fail(e); } };
  const submitEsc = async (event: FormEvent) => { event.preventDefault(); try { await saveEscalationRule(user, esc); reloadRules(); } catch (e) { fail(e); } };
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
  </div>;
}
