/**
 * Activity: write a note, and read everything that happened to the ticket as one timeline, newest first.
 * The timeline merges two sources: notes (people writing) and status history (the ticket moving through its
 * workflow, including automatic moves such as SLA escalations).
 *
 * Two kinds of note:
 *   - Internal: staff only.
 *   - Reply to customer: shown to the customer in the portal, and counts as the first response for the SLA.
 *     Not possible while a supervisor has blocked customer communications (e.g. a fraud investigation).
 */
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Paper, SegmentedControl, Stack, Text, Textarea, Timeline } from '@mantine/core';
import { IconArrowsExchange, IconLock, IconMessage, IconMessageShare } from '@tabler/icons-react';
import { addNote, type Ticket } from '../../../api';
import { EmptyState } from '../../../components/states';
import { PersonName } from '../../../components/person-name';
import { formatDateTime, formatRelative } from '../../../lib/format';
import { statusLook } from '../../../lib/labels';
import { useSession } from '../../../session/session-provider';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

/** One entry in the merged timeline. */
type Entry =
  | { kind: 'note'; at: string; id: string; body: string; author: string; visibility: string }
  | { kind: 'status'; at: string; id: string; from: string | null; to: string; reason: string; author: string };

export function ActivityTab({ ticket }: { ticket: Ticket }) {
  const { can } = useSession();
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');
  const [body, setBody] = useState('');
  const customerBlocked = visibility === 'customer' && Boolean(ticket.communications_blocked);

  const save = useTicketMutation(ticket.id, (user) => addNote(user, ticket.id, body.trim(), visibility), visibility === 'customer' ? 'Reply sent to the customer' : 'Note added');

  const entries = useMemo<Entry[]>(() => [
    ...(ticket.notes ?? []).map((n): Entry => ({ kind: 'note', at: n.createdAt, id: n.id, body: n.body, author: n.authorId, visibility: n.visibility })),
    ...(ticket.history ?? []).map((h, index): Entry => ({ kind: 'status', at: h.changedAt, id: `status-${index}`, from: h.fromStatus, to: h.toStatus, reason: h.reason, author: h.changedBy }))
  ].sort((a, b) => b.at.localeCompare(a.at)), [ticket.notes, ticket.history]);

  return (
    <Stack gap="lg">
      {can('workTicket') && (
        <Paper p="md">
          <Stack gap="sm">
            <SegmentedControl size="xs" value={visibility} onChange={(v) => setVisibility(v as 'internal' | 'customer')} w="fit-content"
              data={[{ value: 'internal', label: 'Internal note' }, { value: 'customer', label: 'Reply to customer' }]} aria-label="Note type" />
            <Textarea aria-label={visibility === 'customer' ? 'Reply to the customer' : 'Add an internal note'} autosize minRows={3} maxLength={10000}
              placeholder={visibility === 'customer' ? 'Visible to the customer in the portal' : 'Only staff can see this'} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
            {customerBlocked && <Alert color="red" variant="light" icon={<IconLock size={16} />} p="xs">A supervisor has blocked customer communications on this case.</Alert>}
            <Group justify="space-between">
              <Text size="xs" c="dimmed">{visibility === 'customer' ? 'Counts as the first response for the service level.' : 'Internal notes are never shown to the customer.'}</Text>
              <Button size="sm" disabled={!body.trim() || customerBlocked} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setBody('') })}>
                {visibility === 'customer' ? 'Send reply' : 'Add note'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {entries.length === 0 ? <EmptyState title="No activity yet" description="Notes and status changes will appear here." /> : (
        <Timeline bulletSize={26} lineWidth={2} className="activity-timeline">
          {entries.map((entry) => entry.kind === 'note' ? (
            <Timeline.Item key={entry.id} bullet={entry.visibility === 'customer' ? <IconMessageShare size={14} /> : <IconMessage size={14} />} color={entry.visibility === 'customer' ? 'teal' : 'gray'}
              title={<Group gap="xs"><PersonName id={entry.author} fw={600} /><Badge size="xs" variant="light" color={entry.visibility === 'customer' ? 'teal' : 'gray'}>{entry.visibility === 'customer' ? 'Sent to customer' : 'Internal'}</Badge></Group>}>
              <Text size="sm" className="pre-wrap" mt={4}>{entry.body}</Text>
              <Text size="xs" c="dimmed" mt={4} title={formatDateTime(entry.at)}>{formatRelative(entry.at)}</Text>
            </Timeline.Item>
          ) : (
            <Timeline.Item key={entry.id} bullet={<IconArrowsExchange size={14} />} color={statusLook(entry.to).color}
              title={<Text size="sm" fw={600}>{entry.from ? `${statusLook(entry.from).label} → ` : 'Opened as '}{statusLook(entry.to).label}</Text>}>
              <Text size="sm" c="dimmed" mt={4}>{entry.reason}</Text>
              <Text size="xs" c="dimmed" mt={4} title={formatDateTime(entry.at)}><PersonName id={entry.author} size="xs" c="dimmed" /> · {formatRelative(entry.at)}</Text>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Stack>
  );
}
