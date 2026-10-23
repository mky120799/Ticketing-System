/**
 * What the ticket is about. Case agents and supervisors can correct the description; the change is audited and,
 * like every edit, refused if someone else changed the ticket since it was loaded.
 */
import { useState } from 'react';
import { Button, Group, Text, Textarea } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { updateTicket, type Ticket } from '../../api';
import { SectionCard } from '../../components/section-card';
import { useSession } from '../../session/session-provider';
import { useTicketMutation } from '../tickets/use-ticket-queries';

export function DescriptionCard({ ticket }: { ticket: Ticket }) {
  const { can } = useSession();
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const save = useTicketMutation(ticket.id, (user, description: string) => updateTicket(user, ticket.id, { description, expectedUpdatedAt: ticket.updatedAt }), 'Description updated');

  return (
    <SectionCard
      title="Description"
      actions={can('workTicket') && draft === null && <Button size="xs" variant="subtle" leftSection={<IconPencil size={14} />} onClick={() => setDraft(ticket.description)}>Edit</Button>}
    >
      {draft === null ? (
        <Text size="sm" className="pre-wrap">{ticket.description}</Text>
      ) : (
        <>
          <Textarea aria-label="Description" autosize minRows={4} maxLength={10000} value={draft} onChange={(e) => setDraft(e.currentTarget.value)} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="xs" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="xs" loading={save.isPending} disabled={draft.trim().length < 3} onClick={() => save.mutate(draft.trim(), { onSuccess: () => setDraft(null) })}>Save</Button>
          </Group>
        </>
      )}
    </SectionCard>
  );
}
