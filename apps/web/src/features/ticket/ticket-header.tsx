/**
 * Top of the case screen: a way back to the queue, the subject as the page's <h1>, the key badges, and the two
 * actions people use most (change status, and for supervisors, assign).
 */
import { Anchor, Badge, Button, Group, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowLeft, IconArrowsExchange, IconUserShare } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';
import type { Ticket } from '../../api';
import { PriorityBadge, RegulatoryBadge, SensitivityBadge, SlaBadge, StatusBadge } from '../../components/badges';
import { caseReference, formatDateTime, humanize } from '../../lib/format';
import { useSession } from '../../session/session-provider';
import { AssignModal } from './assign-modal';
import { ChangeStatusModal } from './change-status-modal';

export function TicketHeader({ ticket }: { ticket: Ticket }) {
  const { can } = useSession();
  const navigate = useNavigate();
  const [statusOpened, statusModal] = useDisclosure(false);
  const [assignOpened, assignModal] = useDisclosure(false);
  const nextStatuses = ticket.allowedNextStatuses ?? [];

  return (
    <Stack gap="xs">
      {/* history.back() keeps the queue's filters; a direct link (no history) falls back to the queue. */}
      <Anchor component={Link} to="/tickets" size="sm" onClick={(event) => { if (window.history.length > 1) { event.preventDefault(); navigate(-1); } }}>
        <Group gap={4}><IconArrowLeft size={14} />Back to tickets</Group>
      </Anchor>

      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Stack gap={6} style={{ flex: '1 1 400px', minWidth: 0 }}>
          <Title order={1} size="h2">{ticket.subject}</Title>
          <Group gap={6} wrap="wrap">
            <StatusBadge status={ticket.status} size="md" />
            <PriorityBadge priority={ticket.priority} size="md" />
            <SlaBadge status={ticket.slaStatus} size="md" />
            <SensitivityBadge sensitivity={ticket.sensitivity} size="md" />
            {ticket.is_complaint && <Badge color="orange" variant="light" size="md">Complaint</Badge>}
            {ticket.regulatory_profile && <RegulatoryBadge status={ticket.regulatory_status} size="md" />}
            {ticket.vulnerability_flag && <Badge color="red" variant="light" size="md">Vulnerable customer</Badge>}
            {ticket.communications_blocked && <Badge color="red" variant="outline" size="md">Communications blocked</Badge>}
            {ticket.retention?.legalHold && <Badge color="grape" variant="light" size="md">Legal hold</Badge>}
          </Group>
          <Text size="sm" c="dimmed">{caseReference(ticket.id)} · {humanize(ticket.category)} · opened {formatDateTime(ticket.createdAt)}</Text>
        </Stack>

        <Group gap="sm">
          {can('supervise') && <Button variant="default" leftSection={<IconUserShare size={16} />} onClick={assignModal.open}>Assign</Button>}
          {can('workTicket') && (
            <Tooltip label="The workflow allows no further moves from this status" disabled={nextStatuses.length > 0}>
              <Button leftSection={<IconArrowsExchange size={16} />} onClick={statusModal.open} disabled={nextStatuses.length === 0}>Change status</Button>
            </Tooltip>
          )}
        </Group>
      </Group>

      <ChangeStatusModal ticket={ticket} opened={statusOpened} onClose={statusModal.close} />
      {can('supervise') && <AssignModal ticket={ticket} opened={assignOpened} onClose={assignModal.close} />}
    </Stack>
  );
}
