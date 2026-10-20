import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DOCUMENT_TYPES, linkStatus, MAX_DOCUMENT_BYTES, sendDocumentByLink, type LinkStatus } from './api';

/** Opened from the secure link the bank sent. No account is needed; the link only allows sending documents to one request. */
export function UploadPage(): JSX.Element {
  const token = window.location.hash.slice(1);
  const [status, setStatus] = useState<LinkStatus | null>(null); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [sending, setSending] = useState(false); const [ready, setReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = async () => { try { setStatus(await linkStatus(token)); setError(''); } catch (e) { setStatus(null); setError(e instanceof Error ? e.message : 'This link is not valid or has expired.'); } finally { setReady(true); } };
  useEffect(() => { void load(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); const file = fileInput.current?.files?.[0]; if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) { setNotice(''); setError('Please choose a PDF, a JPEG or PNG picture, or a text file.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setNotice(''); setError(`Files can be up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`); return; }
    setSending(true); setError('');
    try { await sendDocumentByLink(token, file); if (fileInput.current) fileInput.current.value = ''; setNotice('Thank you. Your document has been sent. We check every document before our staff can open it.'); await load(); }
    catch (e) { setNotice(''); setError(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setSending(false); }
  };
  if (!ready) return <main className="narrow"><p role="status">Loading…</p></main>;
  return <main className="narrow">
    <h1>Send documents to the bank</h1>
    <div aria-live="polite">{notice && <p className="notice">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}</div>
    {status && <>
      <p><strong>Request {status.reference}</strong></p>
      <p className="hint">This link works until {new Date(status.expiresAt).toLocaleString()} and only for this request. You can send {status.remaining} more {status.remaining === 1 ? 'document' : 'documents'}.</p>
      <h2>Documents you have sent</h2>
      {status.documents.length ? <ul className="documents">{status.documents.map((d) => <li key={d.id}><strong>{d.filename}</strong> — {d.status === 'received' ? 'Received' : d.status === 'being_checked' ? 'Being checked' : 'Not accepted. Please send a different file or contact us.'}</li>)}</ul> : <p>You have not sent any documents yet.</p>}
      {status.remaining > 0 && <form onSubmit={(event) => void submit(event)}>
        <label>Choose a document<input ref={fileInput} type="file" required accept=".pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain" aria-describedby="doc-hint" /></label>
        <p id="doc-hint" className="hint">PDF, JPEG, PNG or text files up to {MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Please cover or leave out full card numbers and PINs. The bank will never ask for your PIN or password.</p>
        <button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send document'}</button>
      </form>}
    </>}
  </main>;
}
