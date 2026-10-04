import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { completeSignIn, signIn, signOut, userManager } from './auth';
import { createRequest, getRequest, listRequests, sendMessage, type RequestDetail, type RequestSummary } from './api';

const when = (value: string) => new Date(value).toLocaleString();

export function App(): JSX.Element {
  const [user, setUser] = useState<User | null>(null); const [ready, setReady] = useState(false);
  const [requests, setRequests] = useState<RequestSummary[]>([]); const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [message, setMessage] = useState(''); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [kind, setKind] = useState<'request' | 'complaint' | 'correction'>('request'); const [subject, setSubject] = useState(''); const [description, setDescription] = useState('');
  const submissionKey = useRef(crypto.randomUUID()); const heading = useRef<HTMLHeadingElement>(null);
  const fail = (e: unknown) => { setNotice(''); setError(e instanceof Error ? e.message : 'Something went wrong.'); };

  useEffect(() => { void (async () => { try { const completing = window.location.search.includes('code='); const current = completing ? await completeSignIn() : await userManager.getUser(); if (completing) window.history.replaceState({}, document.title, window.location.pathname); setUser(current && !current.expired ? current : null); } catch { setError('Sign-in could not be completed.'); } finally { setReady(true); } })(); }, []);
  const refresh = (current: User) => { void listRequests(current).then(setRequests).catch(fail); };
  useEffect(() => { const loaded = (renewed: User) => setUser(renewed); const expired = () => { void signOut(); }; userManager.events.addUserLoaded(loaded); userManager.events.addAccessTokenExpired(expired); return () => { userManager.events.removeUserLoaded(loaded); userManager.events.removeAccessTokenExpired(expired); }; }, []);
  useEffect(() => { if (user) refresh(user); }, [user]);

  const open = async (id: string) => { if (!user) return; try { setSelected(await getRequest(user, id)); setError(''); setTimeout(() => heading.current?.focus(), 0); } catch (e) { fail(e); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!user) return; setError('');
    try { const created = await createRequest(user, { kind, subject: subject.trim(), description: description.trim() }, submissionKey.current); submissionKey.current = crypto.randomUUID(); setSubject(''); setDescription(''); setNotice(`Thank you. We have received your ${kind === 'complaint' ? 'complaint' : kind === 'correction' ? 'correction request' : 'request'}. Your reference is ${created.reference}.`); refresh(user); await open(created.id); }
    catch (e) { fail(e); }
  };
  const reply = async (event: FormEvent) => { event.preventDefault(); if (!user || !selected || !message.trim()) return; try { await sendMessage(user, selected.id, message.trim()); setMessage(''); setNotice('Your message has been sent.'); await open(selected.id); } catch (e) { fail(e); } };

  if (!ready) return <main><p role="status">Loading…</p></main>;
  if (!user) return <main className="narrow"><h1>Make a request or complaint</h1><p>Sign in to raise a request or complaint with us and to follow its progress.</p>{error && <p className="error" role="alert">{error}</p>}<button onClick={() => void signIn()}>Sign in</button></main>;
  return <main>
    <header><h1>Your requests and complaints</h1><div><span>{user.profile.preferred_username ?? user.profile.name ?? 'You'}</span> <button className="secondary" onClick={() => void signOut()}>Sign out</button></div></header>
    <div aria-live="polite">{notice && <p className="notice">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
    <div className="layout">
      <section aria-labelledby="new-heading"><h2 id="new-heading">Tell us what happened</h2>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset><legend>What would you like to do?</legend>
            <label className="inline"><input type="radio" name="kind" checked={kind === 'request'} onChange={() => setKind('request')} /> Make a request or ask a question</label>
            <label className="inline"><input type="radio" name="kind" checked={kind === 'complaint'} onChange={() => setKind('complaint')} /> Make a complaint</label>
            <label className="inline"><input type="radio" name="kind" checked={kind === 'correction'} onChange={() => setKind('correction')} /> Ask us to correct information we hold about me</label>
          </fieldset>
          <label>Short summary<input required minLength={3} maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label>Details<textarea required minLength={3} maxLength={5000} rows={6} value={description} onChange={(event) => setDescription(event.target.value)} aria-describedby="privacy-hint" /></label>
          <p id="privacy-hint" className="hint">Please do not include full card numbers, passwords or PINs. We will never ask for them here.</p>
          <button type="submit">Send to the bank</button>
        </form>
      </section>
      <section aria-labelledby="list-heading"><h2 id="list-heading">Your history</h2>
        {requests.length ? <ul className="list">{requests.map((item) => <li key={item.id}><button className="item" onClick={() => void open(item.id)} aria-current={selected?.id === item.id}><strong>{item.subject}</strong><span>{item.reference} · {item.kind === 'complaint' ? 'Complaint · ' : item.kind === 'correction' ? 'Correction request · ' : ''}{item.status}</span><small>Raised {when(item.createdAt)}</small></button></li>)}</ul> : <p>You have not raised anything yet.</p>}
      </section>
      <section aria-labelledby="detail-heading">{selected ? <>
        <h2 id="detail-heading" tabIndex={-1} ref={heading}>{selected.subject}</h2>
        <p><strong>Reference {selected.reference}</strong> · Status: {selected.status}</p>
        {selected.complaint && <p className="notice">{selected.complaint.acknowledged ? `We have acknowledged your ${selected.kind === 'correction' ? 'request' : 'complaint'}.` : `We will acknowledge your ${selected.kind === 'correction' ? 'request' : 'complaint'} shortly.`}{selected.complaint.finalResponseDueBy ? ` You will receive our final response by ${new Date(selected.complaint.finalResponseDueBy).toLocaleDateString()}.` : ''}</p>}
        <h3>What you told us</h3><p className="pre">{selected.description}</p>
        <h3>Updates</h3>
        {selected.updates.length ? <ol className="updates">{selected.updates.map((u, index) => <li key={index} className={u.from}><strong>{u.from === 'you' ? 'You' : 'The bank'}{u.title ? ` — ${u.title}` : ''}</strong><p className="pre">{u.text}</p><small>{when(u.at)}</small></li>)}</ol> : <p>No updates yet. We will let you know here.</p>}
        <form onSubmit={(event) => void reply(event)}><label>Add a message<textarea required maxLength={5000} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} /></label><button type="submit">Send message</button></form>
      </> : <><h2 id="detail-heading">Details</h2><p>Choose a request from your history to see its progress.</p></>}</section>
    </div>
  </main>;
}
