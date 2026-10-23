/**
 * Supervisor: how long the record is kept, and legal holds.
 * A legal hold (for litigation or an investigation) stops the record being de-identified when its retention ends.
 * It needs a reason, and like every retention change needs a recent sign-in (step-up) and is audited.
 */
import { useEffect, useState } from 'react';
import { Button, Group, Paper, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { updateRetention, type Ticket } from '../../../api';
import { formatDateTime } from '../../../lib/format';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

export function RetentionTab({ ticket }: { ticket: Ticket }) {
  const current = ticket.retention;
  const [legalHold, setLegalHold] = useState(false);
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');

  // Reset the form whenever the saved values change (after saving, or a colleague's change arriving live).
  useEffect(() => {
    setLegalHold(current?.legalHold ?? false);
    // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
    setUntil(current?.retentionUntil ? new Date(new Date(current.retentionUntil).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
    setReason('');
  }, [current?.legalHold, current?.retentionUntil]);

  const needsReason = legalHold && !current?.legalHold;
  const save = useTicketMutation(ticket.id, (user) => updateRetention(user, ticket.id, {
    legalHold, ...(until ? { retentionUntil: new Date(until).toISOString() } : {}), ...(reason.trim() ? { holdReason: reason.trim() } : {})
  }), 'Retention updated');

  return (
    <Paper p="lg">
      <Title order={3} size="h5" mb="xs">Retention and legal hold</Title>
      <Text size="sm" c="dimmed" mb="md">
        Currently: {current?.legalHold ? 'legal hold in place' : 'no legal hold'}{current?.retentionUntil ? ` · kept until ${formatDateTime(current.retentionUntil)}` : ' · default retention'}.
      </Text>
      <Stack gap="md" maw={480}>
        <Switch label="Legal hold" description="Prevents de-identification while the hold is in place." checked={legalHold} onChange={(e) => setLegalHold(e.currentTarget.checked)} />
        <TextInput type="datetime-local" label="Keep until" description="Optional. Must be in the future." value={until} onChange={(e) => setUntil(e.currentTarget.value)} />
        <Textarea label={needsReason ? 'Hold reason (required)' : 'Hold reason'} minLength={3} maxLength={500} autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="Why the hold is needed" />
        <Group><Button loading={save.isPending} disabled={needsReason && reason.trim().length < 3} onClick={() => save.mutate(undefined)}>Save retention</Button></Group>
        <Text size="xs" c="dimmed">Needs a recent sign-in. The reason is kept out of integration events.</Text>
      </Stack>
    </Paper>
  );
}
