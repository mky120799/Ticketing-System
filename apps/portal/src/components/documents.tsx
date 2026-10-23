/**
 * Documents: the list of files the customer has sent, and the form to send another.
 * Used both in the signed-in portal and on the secure-link upload page.
 *
 * Files are checked here first (type and size) for a quick, friendly message, but the bank's API re-checks
 * everything and scans each file for malware before any member of staff can open it.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Group, Input, Stack, Text } from '@mantine/core';
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, type PortalAttachment } from '../api';

const STATUS: Record<PortalAttachment['status'], { label: string; color: string }> = {
  received: { label: 'Received', color: 'green' },
  being_checked: { label: 'Being checked', color: 'yellow' },
  not_accepted: { label: 'Not accepted. Please send a different file or contact us.', color: 'red' }
};

export function DocumentList({ documents, empty }: { documents: { id: string; filename: string; status: PortalAttachment['status'] }[]; empty: string }) {
  if (!documents.length) return <Text c="dimmed">{empty}</Text>;
  return (
    <ul className="documents">
      {documents.map((d) => (
        <li key={d.id}>
          <Group justify="space-between" gap="xs">
            <Text fw={600}>{d.filename}</Text>
            <Badge variant="light" color={STATUS[d.status].color} style={{ textTransform: 'none', whiteSpace: 'normal', height: 'auto' }}>{STATUS[d.status].label}</Badge>
          </Group>
        </li>
      ))}
    </ul>
  );
}

const MB = MAX_DOCUMENT_BYTES / 1024 / 1024;

export function DocumentUpload({ send, onSent, onError, label, hint }: { send: (file: File) => Promise<void>; onSent: () => void; onError: (e: unknown) => void; label: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) { onError(new Error('Please choose a PDF, a JPEG or PNG picture, or a text file.')); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { onError(new Error(`Files can be up to ${MB} MB.`)); return; }
    setSending(true);
    try { await send(file); if (input.current) input.current.value = ''; onSent(); }
    catch (e) { onError(e); } finally { setSending(false); }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack gap="sm">
        {/* A native file input keeps its label properly attached for screen readers and on every phone. */}
        <Input.Wrapper id="document-file" label={label} description={hint ?? `PDF, JPEG, PNG or text files up to ${MB} MB. Please cover or leave out full card numbers and PINs.`}>
          <input id="document-file" ref={input} type="file" required className="file-input" aria-describedby="document-file-description"
            accept=".pdf,.jpg,.jpeg,.png,.txt,application/pdf,image/jpeg,image/png,text/plain" />
        </Input.Wrapper>
        <Group><Button type="submit" loading={sending}>Send document</Button></Group>
      </Stack>
    </form>
  );
}
