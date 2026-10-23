/**
 * One request: where it stands, the conversation with the bank, and the documents sent.
 * For complaints the customer is told the date by which the bank must give its final response (a regulatory duty).
 */
import { useState, type FormEvent, type RefObject } from 'react';
import { Alert, Badge, Button, Divider, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import type { User } from 'oidc-client-ts';
import { sendDocument, sendMessage, type RequestDetail as Detail } from '../api';
import { DocumentList, DocumentUpload } from './documents';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function RequestDetail({ user, request, headingRef, onChanged, onError }: { user: User; request: Detail | null; headingRef: RefObject<HTMLHeadingElement>; onChanged: (message: string) => void; onError: (e: unknown) => void }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!request) {
    return (
      <Paper p="lg" component="section" aria-labelledby="detail-heading">
        <Title order={2} size="h3" id="detail-heading">Details</Title>
        <Text c="dimmed" mt="sm">Choose a request from your history to see its progress.</Text>
      </Paper>
    );
  }

  const reply = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try { await sendMessage(user, request.id, message.trim()); setMessage(''); onChanged('Your message has been sent.'); }
    catch (e) { onError(e); } finally { setSending(false); }
  };
  const noun = request.kind === 'correction' ? 'request' : 'complaint';

  return (
    <Paper p="lg" component="section" aria-labelledby="detail-heading">
      <Stack gap="md">
        {/* tabIndex -1 lets the page move focus here when a request opens. */}
        <Title order={2} size="h3" id="detail-heading" tabIndex={-1} ref={headingRef}>{request.subject}</Title>
        <Group gap="xs">
          <Text fw={600}>Reference {request.reference}</Text>
          <Badge variant="light" size="lg">{request.status}</Badge>
        </Group>
        {request.complaint && (
          <Alert color="blue" variant="light" icon={<IconClock size={18} />}>
            {request.complaint.acknowledged ? `We have acknowledged your ${noun}.` : `We will acknowledge your ${noun} shortly.`}
            {request.complaint.finalResponseDueBy ? ` You will receive our final response by ${new Date(request.complaint.finalResponseDueBy).toLocaleDateString(undefined, { dateStyle: 'long' })}.` : ''}
          </Alert>
        )}

        <Stack gap={4}>
          <Title order={3} size="h5">What you told us</Title>
          <Text className="pre-wrap">{request.description}</Text>
        </Stack>

        <Divider />
        <Title order={3} size="h5">Updates</Title>
        {request.updates.length === 0 ? <Text c="dimmed">No updates yet. We will let you know here.</Text> : (
          // Your messages sit on the right in green, the bank's on the left in blue, like a chat.
          <ol className="updates">
            {request.updates.map((u, index) => (
              <li key={index} className={u.from}>
                <Text fw={600} size="sm">{u.from === 'you' ? 'You' : 'The bank'}{u.title ? ` — ${u.title}` : ''}</Text>
                <Text className="pre-wrap" mt={4}>{u.text}</Text>
                <Text size="xs" c="dimmed" mt={4}>{when(u.at)}</Text>
              </li>
            ))}
          </ol>
        )}
        <form onSubmit={(event) => void reply(event)}>
          <Stack gap="sm">
            <Textarea label="Add a message" required maxLength={5000} autosize minRows={3} value={message} onChange={(e) => setMessage(e.currentTarget.value)} />
            <Group><Button type="submit" loading={sending}>Send message</Button></Group>
          </Stack>
        </form>

        <Divider />
        <Title order={3} size="h5">Documents you have sent</Title>
        <DocumentList documents={request.attachments} empty="You have not sent any documents." />
        <DocumentUpload send={(file) => sendDocument(user, request.id, file)} onSent={() => onChanged('Your document has been sent. We check every document before our staff can open it.')} onError={onError} label="Add a document" />
      </Stack>
    </Paper>
  );
}
