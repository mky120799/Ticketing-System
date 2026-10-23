/**
 * "Tell us what happened": raise a request, a complaint, or a request to correct personal information.
 * A complaint or correction starts the bank's regulatory clock straight away.
 *
 * The submission key makes the form safe to resubmit: if the network drops and the customer presses Send again,
 * the bank receives one request, not two (the API treats a repeated key as the same submission).
 */
import { useRef, useState, type FormEvent } from 'react';
import { Button, Paper, Radio, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import type { User } from 'oidc-client-ts';
import { createRequest } from '../api';

type Kind = 'request' | 'complaint' | 'correction';
const THANKS: Record<Kind, string> = { request: 'request', complaint: 'complaint', correction: 'correction request' };

export function NewRequestForm({ user, onCreated, onError }: { user: User; onCreated: (id: string, message: string) => void; onError: (e: unknown) => void }) {
  const [kind, setKind] = useState<Kind>('request');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const submissionKey = useRef(crypto.randomUUID());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      const created = await createRequest(user, { kind, subject: subject.trim(), description: description.trim() }, submissionKey.current);
      submissionKey.current = crypto.randomUUID(); // the next request is a new submission
      setSubject(''); setDescription('');
      onCreated(created.id, `Thank you. We have received your ${THANKS[kind]}. Your reference is ${created.reference}.`);
    } catch (e) { onError(e); } finally { setSending(false); }
  };

  return (
    <Paper p="lg" component="section" aria-labelledby="new-heading">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="md">
          <Title order={2} size="h3" id="new-heading">Tell us what happened</Title>
          <Radio.Group label="What would you like to do?" value={kind} onChange={(value) => setKind(value as Kind)}>
            <Stack gap="xs" mt="xs">
              <Radio value="request" label="Make a request or ask a question" />
              <Radio value="complaint" label="Make a complaint" />
              <Radio value="correction" label="Ask us to correct information we hold about me" />
            </Stack>
          </Radio.Group>
          <TextInput label="Short summary" required minLength={3} maxLength={200} value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Textarea label="Details" required minLength={3} maxLength={5000} autosize minRows={5} value={description} onChange={(e) => setDescription(e.currentTarget.value)}
            description="Please do not include full card numbers, passwords or PINs. We will never ask for them here." />
          <Button type="submit" loading={sending}>Send to the bank</Button>
          <Text size="sm" c="dimmed">You will get a reference number straight away.</Text>
        </Stack>
      </form>
    </Paper>
  );
}
