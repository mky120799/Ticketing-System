/**
 * Routing: who receives work and how it is chosen.
 *   - Queue members: the people auto-assignment can pick, per queue.
 *   - Assignment rules: for new tickets matching queue/category/priority, pick "least loaded" or "round robin".
 *   - Escalation rules: when a ticket misses a target, move it to another queue (and optionally raise priority).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Checkbox, Group, NativeSelect, NumberInput, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { getAssignmentRules, getEscalationRules, getQueueMembers, listPeople, PRIORITIES, saveAssignmentRule, saveEscalationRule, saveQueueMember, type AssignmentRule, type EscalationRule, type QueueMember } from '../../../api';
import { PersonName } from '../../../components/person-name';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { formatRelative, humanize } from '../../../lib/format';
import { ActiveBadge, EditButton, EditorModal, KEY_PATTERN, toOptions, useConfigList, useConfigSave, useScopeOptions } from '../admin-kit';

export function RoutingSection() {
  return <Stack gap="lg"><QueueMembers /><AssignmentRules /><EscalationRules /></Stack>;
}

function QueueMembers() {
  const { queues } = useScopeOptions();
  const [queue, setQueue] = useState('');
  const [newMember, setNewMember] = useState('');
  useEffect(() => { if (!queue && queues[0]) setQueue(queues[0]); }, [queues, queue]);
  const members = useConfigList('members', (user) => getQueueMembers(user, queue), { args: [queue], enabled: Boolean(queue) });
  // People from the staff directory who can work cases, so the administrator picks a name rather than pasting an ID.
  const people = useConfigList('people', (user) => listPeople(user));
  const candidates = (people.data ?? []).filter((p) => !members.data?.some((m) => m.userId === p.subject)).map((p) => ({ value: p.subject, label: p.displayName }));
  const nameOf = (id: string) => people.data?.find((p) => p.subject === id)?.displayName ?? id;
  const save = useConfigSave((user, m: Pick<QueueMember, 'userId' | 'active'>) => saveQueueMember(user, queue, m.userId, m.active), ['members'], (m) => `${nameOf(m.userId)} ${m.active ? 'is active in' : 'removed from rotation in'} ${humanize(queue)}`);
  const add = (event: FormEvent) => { event.preventDefault(); if (newMember.trim()) save.mutate({ userId: newMember.trim(), active: true }, { onSuccess: () => setNewMember('') }); };

  return (
    <SectionCard title="Queue members" description="Members are candidates for automatic assignment. Use the person's identity-provider subject ID.">
      <NativeSelect label="Queue" value={queue} onChange={(e) => setQueue(e.currentTarget.value)} data={toOptions(queues)} maw={320} />
      {members.isPending ? <LoadingBlock rows={3} /> : !members.data?.length ? <EmptyState title="No members in this queue" /> : (
        <Table verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th>Member</Table.Th><Table.Th>Status</Table.Th><Table.Th>Last assigned</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {members.data.map((m) => (
              <Table.Tr key={m.userId}>
                <Table.Td><PersonName id={m.userId} /></Table.Td>
                <Table.Td><ActiveBadge active={m.active} /></Table.Td>
                <Table.Td><Text size="sm">{m.lastAssignedAt ? formatRelative(m.lastAssignedAt) : 'Never'}</Text></Table.Td>
                <Table.Td ta="right"><Button size="compact-xs" variant="subtle" onClick={() => save.mutate({ userId: m.userId, active: !m.active })}>{m.active ? 'Deactivate' : 'Activate'}</Button></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <form onSubmit={add}>
        <Group align="flex-end" gap="sm">
          {/* Pick by name when the directory knows people; otherwise (nobody has signed in yet) type the subject ID. */}
          {candidates.length
            ? <Select label="Add member" searchable data={candidates} value={newMember || null} onChange={(v) => setNewMember(v ?? '')} placeholder="Search by name" style={{ flex: '1 1 240px' }} />
            : <TextInput label="Add member" required value={newMember} onChange={(e) => setNewMember(e.currentTarget.value)} placeholder="Subject ID" description="Nobody new is in the staff directory yet, so enter the subject ID." style={{ flex: '1 1 240px' }} />}
          <Button type="submit" loading={save.isPending}>Add to queue</Button>
        </Group>
      </form>
    </SectionCard>
  );
}

function AssignmentRules() {
  const { queues, categories } = useScopeOptions();
  const rules = useConfigList('assignment-rules', getAssignmentRules);
  const blank: AssignmentRule = { ruleKey: '', queue: queues[0] ?? '', category: null, priority: null, strategy: 'least_loaded', sortOrder: 100, active: true };
  const [draft, setDraft] = useState<AssignmentRule | null>(null);
  const save = useConfigSave(saveAssignmentRule, ['assignment-rules'], (r) => `Assignment rule "${r.ruleKey}" saved`);

  return (
    <SectionCard title="Assignment rules" description="Rules are tried in order (lowest number first); the first match picks the strategy."
      actions={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setDraft(blank)}>New rule</Button>}>
      {rules.isPending ? <LoadingBlock rows={3} /> : !rules.data?.length ? <EmptyState title="No assignment rules" /> : (
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Order</Table.Th><Table.Th>Rule</Table.Th><Table.Th>Matches</Table.Th><Table.Th>Strategy</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {[...rules.data].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => (
                <Table.Tr key={r.ruleKey}>
                  <Table.Td>{r.sortOrder}</Table.Td>
                  <Table.Td><Text size="sm" fw={500}>{r.ruleKey}</Text></Table.Td>
                  <Table.Td><Text size="sm">{humanize(r.queue)} · {r.category ? humanize(r.category) : 'any category'} · {r.priority ? humanize(r.priority) : 'any priority'}</Text></Table.Td>
                  <Table.Td><Text size="sm">{humanize(r.strategy)}</Text></Table.Td>
                  <Table.Td><ActiveBadge active={r.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${r.ruleKey}`} onClick={() => setDraft(r)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal title={draft.ruleKey ? `Assignment rule: ${draft.ruleKey}` : 'New assignment rule'} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <TextInput label="Rule key" required pattern={KEY_PATTERN} value={draft.ruleKey} onChange={(e) => setDraft({ ...draft, ruleKey: e.currentTarget.value })} description="Lowercase letters, numbers and hyphens" />
          <SimpleGrid cols={2}>
            <NativeSelect label="Queue" value={draft.queue} onChange={(e) => setDraft({ ...draft, queue: e.currentTarget.value })} data={toOptions(queues)} />
            <NativeSelect label="Category" value={draft.category ?? ''} onChange={(e) => setDraft({ ...draft, category: e.currentTarget.value || null })} data={[{ value: '', label: 'Any' }, ...toOptions(categories)]} />
            <NativeSelect label="Priority" value={draft.priority ?? ''} onChange={(e) => setDraft({ ...draft, priority: e.currentTarget.value || null })} data={[{ value: '', label: 'Any' }, ...toOptions(PRIORITIES)]} />
            <NativeSelect label="Strategy" value={draft.strategy} onChange={(e) => setDraft({ ...draft, strategy: e.currentTarget.value })} data={[{ value: 'least_loaded', label: 'Least loaded' }, { value: 'round_robin', label: 'Round robin' }]} />
            <NumberInput label="Order" min={1} max={10000} value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) || 1 })} />
          </SimpleGrid>
          <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
        </EditorModal>
      )}
    </SectionCard>
  );
}

function EscalationRules() {
  const { queues } = useScopeOptions();
  const rules = useConfigList('escalation-rules', getEscalationRules);
  const blank: EscalationRule = { ruleKey: '', queue: queues[0] ?? '', trigger: 'first_response_overdue', escalateToQueue: queues[1] ?? queues[0] ?? '', raisePriority: true, active: true };
  const [draft, setDraft] = useState<EscalationRule | null>(null);
  const save = useConfigSave(saveEscalationRule, ['escalation-rules'], (r) => `Escalation rule "${r.ruleKey}" saved`);

  return (
    <SectionCard title="Escalation rules" description="What happens automatically when a ticket misses a service level."
      actions={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setDraft(blank)}>New rule</Button>}>
      {rules.isPending ? <LoadingBlock rows={3} /> : !rules.data?.length ? <EmptyState title="No escalation rules" /> : (
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Rule</Table.Th><Table.Th>When</Table.Th><Table.Th>Move</Table.Th><Table.Th>Priority</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rules.data.map((r) => (
                <Table.Tr key={r.ruleKey}>
                  <Table.Td><Text size="sm" fw={500}>{r.ruleKey}</Text></Table.Td>
                  <Table.Td><Text size="sm">{humanize(r.trigger)}</Text></Table.Td>
                  <Table.Td><Text size="sm">{humanize(r.queue)} → {humanize(r.escalateToQueue)}</Text></Table.Td>
                  <Table.Td><Text size="sm">{r.raisePriority ? 'Raise one step' : 'Unchanged'}</Text></Table.Td>
                  <Table.Td><ActiveBadge active={r.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${r.ruleKey}`} onClick={() => setDraft(r)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal title={draft.ruleKey ? `Escalation rule: ${draft.ruleKey}` : 'New escalation rule'} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <TextInput label="Rule key" required pattern={KEY_PATTERN} value={draft.ruleKey} onChange={(e) => setDraft({ ...draft, ruleKey: e.currentTarget.value })} />
          <SimpleGrid cols={2}>
            <NativeSelect label="From queue" value={draft.queue} onChange={(e) => setDraft({ ...draft, queue: e.currentTarget.value })} data={toOptions(queues)} />
            <NativeSelect label="Escalate to" value={draft.escalateToQueue} onChange={(e) => setDraft({ ...draft, escalateToQueue: e.currentTarget.value })} data={toOptions(queues)} />
            <NativeSelect label="Trigger" value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.currentTarget.value })} data={[{ value: 'first_response_overdue', label: 'First response overdue' }, { value: 'breached', label: 'Resolution breached' }]} />
          </SimpleGrid>
          <Checkbox label="Raise priority one step" checked={draft.raisePriority} onChange={(e) => setDraft({ ...draft, raisePriority: e.currentTarget.checked })} />
          <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
        </EditorModal>
      )}
    </SectionCard>
  );
}
