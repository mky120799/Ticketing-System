/**
 * Supervisor action: move a ticket to a queue and (optionally) a named person.
 * Leaving the person empty returns it to the queue's pool, where auto-assignment rules can pick it up.
 *
 * People are picked BY NAME from the staff directory (those who can work cases in the chosen queue). The ticket still
 * stores the person's subject ID, which never changes; the name is only for display.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Group, Modal, NativeSelect, Select, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { assignTicket, listPeople, type Ticket } from '../../api';
import { usePersonName } from '../../components/person-name';
import { humanize } from '../../lib/format';
import { useSession, useSignedInUser } from '../../session/session-provider';
import { useTicketMutation } from '../tickets/use-ticket-queries';

export function AssignModal({ ticket, opened, onClose }: { ticket: Ticket; opened: boolean; onClose: () => void }) {
  const user = useSignedInUser();
  const { profile } = useSession();
  const [queue, setQueue] = useState(ticket.queue);
  const [assignee, setAssignee] = useState<string | null>(ticket.assigned_to ?? null);
  const currentName = usePersonName(ticket.assigned_to).name;

  // Start from the ticket's current values each time the dialog opens.
  useEffect(() => { if (opened) { setQueue(ticket.queue); setAssignee(ticket.assigned_to ?? null); } }, [opened, ticket.queue, ticket.assigned_to]);

  // Everyone in the directory who can work cases in this queue. Reloaded when the queue changes.
  const people = useQuery({ queryKey: ['directory', 'people', queue], queryFn: () => listPeople(user, queue), enabled: opened });

  const options = useMemo(() => {
    const list = (people.data ?? []).map((p) => ({ value: p.subject, label: p.username && p.username !== p.displayName ? `${p.displayName} (${p.username})` : p.displayName }));
    // Keep the current assignee selectable even if they are not in the list (e.g. they never opened the console).
    if (ticket.assigned_to && !list.some((o) => o.value === ticket.assigned_to)) list.unshift({ value: ticket.assigned_to, label: currentName ?? ticket.assigned_to });
    // ...and "Assign to me" must always have an option to select.
    if (profile && !list.some((o) => o.value === profile.subject)) list.push({ value: profile.subject, label: `${profile.displayName ?? 'Me'} (me)` });
    return list;
  }, [people.data, ticket.assigned_to, currentName, profile]);
  const chosenName = options.find((o) => o.value === assignee)?.label;

  const assign = useTicketMutation(ticket.id, (u) => assignTicket(u, ticket.id, { queue, ...(assignee ? { assigneeId: assignee } : {}), expectedUpdatedAt: ticket.updatedAt }),
    () => (assignee ? `Assigned to ${chosenName ?? 'the selected person'}` : `Returned to the ${humanize(queue)} queue`));

  const submit = (event: FormEvent) => { event.preventDefault(); assign.mutate(undefined, { onSuccess: onClose }); };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={650} size="lg">Assign ticket</Text>}>
      <form onSubmit={submit}>
        <Stack gap="md">
          <NativeSelect label="Queue" value={queue} onChange={(e) => { setQueue(e.currentTarget.value); setAssignee(null); }} data={(profile?.queues ?? []).map((q) => ({ value: q, label: humanize(q) }))} />
          <Select
            label="Assignee" searchable clearable data={options} value={assignee} onChange={setAssignee}
            placeholder={people.isPending ? 'Loading people…' : 'Nobody: return the ticket to the queue'}
            nothingFoundMessage="No one with this queue has opened the console yet"
            description="Type to search by name. Leave empty to return the ticket to the queue."
          />
          {profile && <Group><Button size="compact-xs" variant="light" onClick={() => setAssignee(profile.subject)}>Assign to me</Button></Group>}
          <Text size="xs" c="dimmed">Assigning sets the status to Assigned and notifies the person.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={assign.isPending}>Assign</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
