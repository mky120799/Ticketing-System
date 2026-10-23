/**
 * Moving a ticket through its workflow.
 *
 * Rules the form follows (the API enforces all of them too):
 *   - Only next statuses the ticket's workflow allows are offered (the API sends `allowedNextStatuses`).
 *   - Resolving needs a root cause, which feeds the root-cause reporting on the dashboard.
 *   - Resolving a complaint or privacy request also needs its formal outcome.
 *   - `expectedUpdatedAt` protects against overwriting a colleague's change made a moment earlier (409 conflict).
 */
import { useState, type FormEvent } from 'react';
import { Button, Group, Modal, NativeSelect, Stack, Text, Textarea } from '@mantine/core';
import { IDR_OUTCOMES, PRIVACY_OUTCOMES, ROOT_CAUSES, transitionTicket, type Ticket } from '../../api';
import { humanize } from '../../lib/format';
import { statusLook } from '../../lib/labels';
import { useSignedInUser } from '../../session/session-provider';
import { useTicketMutation } from '../tickets/use-ticket-queries';

export function ChangeStatusModal({ ticket, opened, onClose }: { ticket: Ticket; opened: boolean; onClose: () => void }) {
  const user = useSignedInUser();
  const [next, setNext] = useState('');
  const [reason, setReason] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [outcome, setOutcome] = useState('');

  const resolving = next === 'resolved';
  const regulated = Boolean(ticket.regulatory_profile);
  const privacy = ticket.case_kind === 'privacy_request';
  const outcomes: readonly string[] = privacy ? PRIVACY_OUTCOMES : IDR_OUTCOMES;
  const incomplete = !next || (resolving && (!rootCause || (regulated && !outcome)));

  const reset = () => { setNext(''); setReason(''); setRootCause(''); setOutcome(''); };
  const close = () => { reset(); onClose(); };

  const change = useTicketMutation(ticket.id, (u) => transitionTicket(
    u, ticket.id, next,
    // A reason is always recorded in the status history; if none is typed, say who did it.
    reason.trim() || `Status changed to ${statusLook(next).label} by ${user.profile.preferred_username ?? user.profile.sub}`,
    resolving ? rootCause : undefined, resolving && regulated ? outcome : undefined, ticket.updatedAt
  ), `Status changed to ${statusLook(next).label}`);

  const submit = (event: FormEvent) => { event.preventDefault(); change.mutate(undefined, { onSuccess: close }); };

  return (
    <Modal opened={opened} onClose={close} title={<Text fw={650} size="lg">Change status</Text>}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">Currently <strong>{statusLook(ticket.status).label}</strong>. Only moves allowed by this ticket's workflow are listed.</Text>
          <NativeSelect label="New status" required value={next} onChange={(e) => setNext(e.currentTarget.value)}
            data={[{ value: '', label: 'Select the next status' }, ...(ticket.allowedNextStatuses ?? []).map((s) => ({ value: s, label: statusLook(s).label }))]} />
          {resolving && (
            <NativeSelect label="Root cause (required)" required value={rootCause} onChange={(e) => setRootCause(e.currentTarget.value)}
              description="What caused the issue. Used for root-cause reporting."
              data={[{ value: '', label: 'Select root cause' }, ...ROOT_CAUSES.map((c) => ({ value: c, label: humanize(c) }))]} />
          )}
          {resolving && regulated && (
            <NativeSelect label={privacy ? 'Privacy request outcome (required)' : 'Complaint outcome (required)'} required value={outcome} onChange={(e) => setOutcome(e.currentTarget.value)}
              data={[{ value: '', label: 'Select outcome' }, ...outcomes.map((o) => ({ value: o, label: humanize(o) }))]} />
          )}
          <Textarea label="Reason (optional)" description="Recorded in the ticket's status history." maxLength={500} autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={incomplete} loading={change.isPending}>Save status</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
