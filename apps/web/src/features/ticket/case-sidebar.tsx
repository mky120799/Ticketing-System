/**
 * The right-hand column of the case screen: facts a case worker glances at constantly.
 *   - Details: status, priority (editable), queue, assignee, where it came from.
 *   - Service levels: the two SLA targets and whether they are being met.
 *   - Customer references: masked. A supervisor can "reveal" them, which needs a recent sign-in and is audited.
 */
import { useState } from 'react';
import { Alert, Button, Code, Group, Modal, NativeSelect, Paper, SimpleGrid, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconEye, IconShieldLock } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { PRIORITIES, revealReferences, updateTicket, type RevealedReference, type Ticket } from '../../api';
import { PriorityBadge, SlaBadge, StatusBadge } from '../../components/badges';
import { PersonName } from '../../components/person-name';
import { formatDateTime, formatRelative, humanize } from '../../lib/format';
import { isOverdue, priorityLook } from '../../lib/labels';
import { useSession } from '../../session/session-provider';
import { useTicketMutation } from '../tickets/use-ticket-queries';

/** One label/value line. */
const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <Stack gap={2}>
    <Text size="xs" c="dimmed" fw={500}>{label}</Text>
    <div>{typeof children === 'string' ? <Text size="sm">{children}</Text> : children}</div>
  </Stack>
);

/** A due date as "in 3 hours", with the exact time on hover, in red once it has passed. */
const Due = ({ at, overdue }: { at: string | null | undefined; overdue: boolean }) => at
  ? <Tooltip label={formatDateTime(at)}><Text size="sm" c={overdue ? 'red' : undefined} fw={overdue ? 600 : undefined}>{formatRelative(at)}</Text></Tooltip>
  : <Text size="sm" c="dimmed">No target</Text>;

export function CaseSidebar({ ticket }: { ticket: Ticket }) {
  const { can } = useSession();
  const [revealed, setRevealed] = useState<RevealedReference[] | null>(null);

  const changePriority = useTicketMutation(ticket.id, (user, priority: string) => updateTicket(user, ticket.id, { priority, expectedUpdatedAt: ticket.updatedAt }), (t) => `Priority set to ${priorityLook(t.priority).label}`);
  // The reveal result is shown once in a dialog and never cached, so the full values do not linger in memory.
  const reveal = useTicketMutation(ticket.id, (user) => revealReferences(user, ticket.id));

  return (
    <Stack gap="lg">
      <Paper p="lg">
        <Title order={2} size="h5" mb="md">Details</Title>
        <SimpleGrid cols={2} spacing="md" verticalSpacing="md">
          <Fact label="Status"><StatusBadge status={ticket.status} /></Fact>
          <Fact label="Priority">
            {can('workTicket')
              ? <NativeSelect aria-label="Priority" size="xs" value={ticket.priority} disabled={changePriority.isPending} onChange={(e) => changePriority.mutate(e.currentTarget.value)} data={PRIORITIES.map((p) => ({ value: p, label: priorityLook(p).label }))} />
              : <PriorityBadge priority={ticket.priority} />}
          </Fact>
          <Fact label="Queue">{humanize(ticket.queue)}</Fact>
          <Fact label="Assignee"><PersonName id={ticket.assigned_to} empty="Unassigned" /></Fact>
          <Fact label="Category">{humanize(ticket.category)}</Fact>
          <Fact label="Source">{humanize(ticket.source_channel ?? 'staff')}</Fact>
          <Fact label="Branch">{ticket.branchCode}</Fact>
          <Fact label="Last updated">{ticket.updatedAt ? formatRelative(ticket.updatedAt) : '—'}</Fact>
        </SimpleGrid>
        {ticket.root_cause && <Text size="xs" c="dimmed" mt="md">Root cause: {humanize(ticket.root_cause)}</Text>}
      </Paper>

      <Paper p="lg">
        <Group justify="space-between" mb="md">
          <Title order={2} size="h5">Service levels</Title>
          <SlaBadge status={ticket.slaStatus} />
        </Group>
        <SimpleGrid cols={2}>
          <Fact label="First response due"><Due at={ticket.firstResponseDueAt} overdue={ticket.slaStatus === 'first_response_overdue'} /></Fact>
          <Fact label="Resolution due"><Due at={ticket.resolutionDueAt} overdue={ticket.slaStatus === 'breached'} /></Fact>
        </SimpleGrid>
        {isOverdue(ticket.slaStatus) && <Text size="xs" c="red" mt="sm">A target has been missed. Escalation rules may have moved or re-prioritised this ticket.</Text>}
      </Paper>

      <Paper p="lg">
        <Group justify="space-between" mb="sm">
          <Title order={2} size="h5">Customer references</Title>
          {can('supervise') && Boolean(ticket.references?.length) && (
            <Button size="compact-xs" variant="light" leftSection={<IconEye size={14} />} loading={reveal.isPending}
              onClick={() => reveal.mutate(undefined, { onSuccess: setRevealed })}>Reveal</Button>
          )}
        </Group>
        {ticket.references?.length ? (
          <Stack gap="xs">
            {ticket.references.map((r) => (
              <Group key={`${r.sourceSystem}${r.maskedValue}`} justify="space-between" wrap="nowrap">
                <Text size="sm">{humanize(r.referenceType)} <Text span size="xs" c="dimmed">({r.sourceSystem})</Text></Text>
                <Code>{r.maskedValue}</Code>
              </Group>
            ))}
          </Stack>
        ) : <Text size="sm" c="dimmed">No references recorded.</Text>}
        <Text size="xs" c="dimmed" mt="sm">References are masked. Revealing one is a separately authorised, audited action.</Text>
      </Paper>

      <Modal opened={revealed !== null} onClose={() => setRevealed(null)} title={<Text fw={650}>Revealed references</Text>}>
        <Stack>
          <Alert color="yellow" icon={<IconShieldLock size={16} />}>This reveal has been recorded in the audit trail under your name. Close this window when you are done.</Alert>
          {revealed?.map((r) => (
            <Group key={`${r.sourceSystem}${r.opaqueReference}`} justify="space-between">
              <Text size="sm">{humanize(r.referenceType)} ({r.sourceSystem})</Text>
              <Code>{r.opaqueReference}</Code>
            </Group>
          ))}
          <Button onClick={() => setRevealed(null)}>Close</Button>
        </Stack>
      </Modal>
      {ticket.created_by && <Text size="xs" c="dimmed" ta="center">Created by <PersonName id={ticket.created_by} size="xs" /></Text>}
    </Stack>
  );
}
