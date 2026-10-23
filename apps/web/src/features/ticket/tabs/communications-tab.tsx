/**
 * Governed customer communications. Staff never write free-text emails here: they pick an approved template,
 * and the recipient is an opaque reference (shown masked afterwards). Some templates need a second person's
 * approval before they are sent (maker-checker: the requester can never approve their own message).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Group, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconCheck, IconLock, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { createCommunication, decideApproval, getCommunicationTemplates, type Ticket } from '../../../api';
import { EmptyState } from '../../../components/states';
import { formatRelative, humanize } from '../../../lib/format';
import { communicationLook } from '../../../lib/labels';
import { queryKeys } from '../../../lib/query-keys';
import { useSession, useSignedInUser } from '../../../session/session-provider';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

export function CommunicationsTab({ ticket }: { ticket: Ticket }) {
  const user = useSignedInUser();
  const { can } = useSession();
  const templates = useQuery({ queryKey: queryKeys.communicationTemplates, queryFn: () => getCommunicationTemplates(user), staleTime: 600_000 });
  const [template, setTemplate] = useState('');
  const [recipient, setRecipient] = useState('');
  useEffect(() => { const first = templates.data?.[0]; if (first && !template) setTemplate(`${first.channel}:${first.templateKey}`); }, [templates.data, template]);

  const queue = useTicketMutation(ticket.id, (u) => {
    const [channel, templateKey] = template.split(':');
    return createCommunication(u, ticket.id, { channel, templateKey, recipientReference: recipient.trim() });
  }, (result) => (result.status === 'pending_approval' ? 'Queued. A supervisor must approve it before it is sent.' : 'Communication queued'));
  const decide = useTicketMutation(ticket.id, (u, v: { approvalId: string; decision: 'approved' | 'rejected' }) => decideApproval(u, ticket.id, v.approvalId, v.decision),
    (result) => `Communication ${result.status}`);

  const submit = (event: FormEvent) => { event.preventDefault(); queue.mutate(undefined, { onSuccess: () => setRecipient('') }); };
  const communications = ticket.communications ?? [];

  return (
    <Stack gap="lg">
      {communications.length === 0 ? <EmptyState title="No customer communications yet" /> : (
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm">
            <Table.Thead><Table.Tr><Table.Th>Template</Table.Th><Table.Th>Channel</Table.Th><Table.Th>Recipient</Table.Th><Table.Th>Status</Table.Th><Table.Th>When</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {communications.map((c) => {
                const look = communicationLook(c.status);
                return (
                  <Table.Tr key={c.id}>
                    <Table.Td><Text size="sm" fw={500}>{c.templateKey}</Text></Table.Td>
                    <Table.Td><Text size="sm">{humanize(c.channel)}</Text></Table.Td>
                    <Table.Td><Text size="sm" ff="monospace">{c.recipientMasked}</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={look.color}>{look.label}</Badge></Table.Td>
                    <Table.Td><Text size="sm">{formatRelative(c.createdAt)}</Text></Table.Td>
                    <Table.Td>
                      {c.status === 'pending_approval' && c.approvalId && can('supervise') && (
                        <Group gap={4} wrap="nowrap">
                          <Button size="compact-xs" leftSection={<IconCheck size={12} />} loading={decide.isPending} onClick={() => decide.mutate({ approvalId: c.approvalId!, decision: 'approved' })}>Approve</Button>
                          <Button size="compact-xs" variant="default" leftSection={<IconX size={12} />} disabled={decide.isPending} onClick={() => decide.mutate({ approvalId: c.approvalId!, decision: 'rejected' })}>Reject</Button>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {can('workTicket') && (
        <Paper p="md">
          {ticket.communications_blocked ? (
            <Alert color="red" variant="light" icon={<IconLock size={16} />} title="Customer communications are blocked">A supervisor has blocked customer communications on this case, for example during a fraud investigation.</Alert>
          ) : (
            <form onSubmit={submit}>
              <Stack gap="sm">
                <Text fw={600} size="sm">Send a communication</Text>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <NativeSelect label="Template" value={template} onChange={(e) => setTemplate(e.currentTarget.value)}
                    data={templates.data?.map((t) => ({ value: `${t.channel}:${t.templateKey}`, label: `${humanize(t.templateKey)} (${t.channel})${t.requiresApproval ? ' · needs approval' : ''}` })) ?? [{ value: '', label: 'Loading…' }]} />
                  <TextInput label="Recipient reference" required minLength={8} maxLength={255} value={recipient} onChange={(e) => setRecipient(e.currentTarget.value)} placeholder="Opaque recipient reference" />
                </SimpleGrid>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Only the masked recipient is shown after sending.</Text>
                  <Button type="submit" loading={queue.isPending} disabled={!template}>Queue communication</Button>
                </Group>
              </Stack>
            </form>
          )}
        </Paper>
      )}
    </Stack>
  );
}
