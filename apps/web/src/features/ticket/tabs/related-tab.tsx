/**
 * Links between tickets: "duplicate of", "related to", "parent of". Only IDs are stored, so a link never exposes
 * another ticket's content; opening a linked ticket goes through the normal access check.
 */
import { useState, type FormEvent } from 'react';
import { Anchor, Button, Group, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { Link } from 'react-router-dom';
import { linkTicket, type Ticket } from '../../../api';
import { EmptyState } from '../../../components/states';
import { caseReference, humanize } from '../../../lib/format';
import { useSession } from '../../../session/session-provider';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

const TYPES = [{ value: 'related_to', label: 'Related to' }, { value: 'duplicate_of', label: 'Duplicate of' }, { value: 'parent_of', label: 'Parent of' }];

export function RelatedTab({ ticket }: { ticket: Ticket }) {
  const { can } = useSession();
  const [target, setTarget] = useState('');
  const [type, setType] = useState('related_to');
  const link = useTicketMutation(ticket.id, (user) => linkTicket(user, ticket.id, target.trim(), type), 'Tickets linked');
  const submit = (event: FormEvent) => { event.preventDefault(); link.mutate(undefined, { onSuccess: () => setTarget('') }); };
  const links = ticket.relatedTickets ?? [];

  return (
    <Stack gap="lg">
      {links.length === 0 ? <EmptyState title="No linked tickets" /> : (
        <Table verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Relationship</Table.Th><Table.Th>Ticket</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {links.map((l) => (
              <Table.Tr key={`${l.ticketId}${l.relationshipType}${l.direction}`}>
                {/* "incoming" means the other ticket points at this one, e.g. it is a duplicate of this ticket. */}
                <Table.Td><Text size="sm">{l.direction === 'outgoing' ? `This ticket is ${humanize(l.relationshipType).toLowerCase()}` : `Target of "${humanize(l.relationshipType).toLowerCase()}" from`}</Text></Table.Td>
                <Table.Td><Anchor component={Link} to={`/tickets/${l.ticketId}`} size="sm" ff="monospace">{caseReference(l.ticketId)}</Anchor></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {can('workTicket') && (
        <Paper p="md">
          <form onSubmit={submit}>
            <Stack gap="sm">
              <Text fw={600} size="sm">Link another ticket</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Ticket ID" description="The full ID, from the other ticket's address bar" required pattern="[0-9a-fA-F-]{36}" value={target} onChange={(e) => setTarget(e.currentTarget.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                <NativeSelect label="Relationship" value={type} onChange={(e) => setType(e.currentTarget.value)} data={TYPES} />
              </SimpleGrid>
              <Group justify="flex-end"><Button type="submit" loading={link.isPending}>Link ticket</Button></Group>
            </Stack>
          </form>
        </Paper>
      )}
    </Stack>
  );
}
