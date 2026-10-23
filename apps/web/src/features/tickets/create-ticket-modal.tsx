/**
 * "New ticket" form, in a pop-up dialog (modal) so it no longer takes a third of the screen permanently.
 *
 * Improvements over the old form:
 *   - Branch, department, legal entity and country are filled in from the signed-in person's profile. The API
 *     requires them to match the person's own scope, so typing them was pure busywork and a source of errors.
 *   - Category and queue are picked from lists; picking a category pre-selects its default queue.
 *   - The customer reference is explained: an opaque ID from the source system, never a raw account or card number.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Group, Modal, NativeSelect, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createTicket, PRIORITIES, REFERENCE_TYPES, SENSITIVITIES } from '../../api';
import { humanize } from '../../lib/format';
import { notifySuccess } from '../../lib/notify';
import { queryKeys } from '../../lib/query-keys';
import { useSession, useSignedInUser } from '../../session/session-provider';
import { patchTicketInLists } from './ticket-cache';
import { useCategories } from './use-ticket-queries';

const EMPTY = { subject: '', description: '', category: '', queue: '', priority: 'normal', sensitivity: 'standard', referenceType: 'customer', sourceSystem: 'CRM', opaqueReference: '' };

export function CreateTicketModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const user = useSignedInUser();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories();
  const [form, setForm] = useState(EMPTY);
  // Read the value immediately: React clears `currentTarget` once the handler returns, and the updater may run later.
  const set = (field: keyof typeof EMPTY) => (event: { currentTarget: { value: string } }) => {
    const value = event.currentTarget.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  // Pre-select the first category (and its queue) once the list arrives.
  useEffect(() => {
    const first = categories.data?.[0];
    if (opened && first && !form.category) setForm((f) => ({ ...f, category: first.category, queue: first.defaultQueue }));
  }, [opened, categories.data, form.category]);

  const create = useMutation({
    mutationFn: () => {
      const { referenceType, sourceSystem, opaqueReference, ...fields } = form;
      return createTicket(user, {
        ...fields,
        subject: fields.subject.trim(), description: fields.description.trim(),
        // Scope comes from the profile: the API refuses a ticket outside the creator's own scope anyway.
        branchCode: profile!.branch, department: profile!.department, legalEntity: profile!.legalEntity, country: profile!.country,
        references: [{ referenceType, sourceSystem: sourceSystem.trim(), opaqueReference: opaqueReference.trim() }],
        customFields: {}
      });
    },
    onSuccess: (ticket) => {
      // Put the new ticket straight into the caches, then open it.
      queryClient.setQueryData(queryKeys.ticket(ticket.id), ticket);
      patchTicketInLists(queryClient, ticket, { addIfMissing: true });
      notifySuccess(`Ticket "${ticket.subject}" created`);
      setForm(EMPTY);
      onClose();
      navigate(`/tickets/${ticket.id}`);
    }
  });

  const submit = (event: FormEvent) => { event.preventDefault(); create.mutate(); };
  const pickCategory = (category: string) => {
    const match = categories.data?.find((c) => c.category === category);
    setForm((f) => ({ ...f, category, queue: match?.defaultQueue ?? f.queue }));
  };

  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={650} size="lg">New ticket</Text>} size="lg">
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput label="Subject" required minLength={3} maxLength={200} value={form.subject} onChange={set('subject')} placeholder="Short summary of the issue" data-autofocus />
          <Textarea label="Description" required minLength={3} maxLength={10000} autosize minRows={4} value={form.description} onChange={set('description')} />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NativeSelect label="Category" required value={form.category} onChange={(e) => pickCategory(e.currentTarget.value)}
              data={categories.data?.map((c) => ({ value: c.category, label: humanize(c.category) })) ?? [{ value: '', label: 'Loading…' }]} />
            <NativeSelect label="Queue" required value={form.queue} onChange={set('queue')}
              data={(profile?.queues ?? []).map((q) => ({ value: q, label: humanize(q) }))} />
            <NativeSelect label="Priority" value={form.priority} onChange={set('priority')} data={PRIORITIES.map((p) => ({ value: p, label: humanize(p) }))} />
            <NativeSelect label="Sensitivity" value={form.sensitivity} onChange={set('sensitivity')}
              description="Restricted tickets are visible to supervisors and auditors only."
              data={SENSITIVITIES.map((s) => ({ value: s, label: humanize(s) }))} />
          </SimpleGrid>

          <Alert variant="light" color="gray" icon={<IconShieldLock size={16} />} title="Protecting customer data">
            <Text size="sm">Use the opaque ID from the source system. Never enter raw account numbers, card numbers or PINs: the reference is masked on screen and only a supervisor can reveal it.</Text>
          </Alert>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <NativeSelect label="Reference type" value={form.referenceType} onChange={set('referenceType')} data={REFERENCE_TYPES.map((r) => ({ value: r, label: humanize(r) }))} />
            <TextInput label="Source system" required minLength={2} maxLength={80} value={form.sourceSystem} onChange={set('sourceSystem')} />
            <TextInput label="Customer reference" required minLength={8} maxLength={255} value={form.opaqueReference} onChange={set('opaqueReference')} placeholder="e.g. opaque-customer-1234" />
          </SimpleGrid>

          {profile && <Text size="xs" c="dimmed">Recorded under branch {profile.branch}, department {profile.department}, {profile.legalEntity} / {profile.country}.</Text>}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={create.isPending}>Create ticket</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
