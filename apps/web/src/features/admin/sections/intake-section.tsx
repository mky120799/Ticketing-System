/**
 * Intake channels: defaults for tickets that arrive without a staff member (email, portal, mobile app...).
 * Channel adapters sign in as the "intake-gateway" service identity; these settings decide where their tickets land.
 */
import { useState } from 'react';
import { Button, Checkbox, NativeSelect, SimpleGrid, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { getIntakeChannels, PRIORITIES, saveIntakeChannel, type IntakeChannel } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { humanize } from '../../../lib/format';
import { ActiveBadge, EditButton, EditorModal, toOptions, useConfigList, useConfigSave, useScopeOptions } from '../admin-kit';

const CHANNELS = ['email', 'portal', 'mobile', 'phone', 'internal'];

export function IntakeSection() {
  const { queues, categories } = useScopeOptions();
  const channels = useConfigList('intake-channels', getIntakeChannels);
  const blank: IntakeChannel = { channel: 'email', defaultCategory: categories[0] ?? '', defaultQueue: queues[0] ?? '', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true };
  const [draft, setDraft] = useState<IntakeChannel | null>(null);
  const save = useConfigSave(saveIntakeChannel, ['intake-channels'], (c) => `${humanize(c.channel)} channel saved`);

  return (
    <SectionCard title="Intake channels" description="Where tickets that arrive by email, portal or app are filed, and with what priority."
      actions={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setDraft(blank)}>Configure channel</Button>}>
      {channels.isPending ? <LoadingBlock rows={3} /> : !channels.data?.length ? <EmptyState title="No channels configured" /> : (
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Channel</Table.Th><Table.Th>Category</Table.Th><Table.Th>Queue</Table.Th><Table.Th>Branch</Table.Th><Table.Th>Priority</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {channels.data.map((c) => (
                <Table.Tr key={c.channel}>
                  <Table.Td><Text size="sm" fw={500}>{humanize(c.channel)}</Text></Table.Td>
                  <Table.Td>{humanize(c.defaultCategory)}</Table.Td>
                  <Table.Td>{humanize(c.defaultQueue)}</Table.Td>
                  <Table.Td>{c.branchCode}</Table.Td>
                  <Table.Td>{humanize(c.defaultPriority)}</Table.Td>
                  <Table.Td><ActiveBadge active={c.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${c.channel}`} onClick={() => setDraft(c)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal title={`Intake channel: ${humanize(draft.channel)}`} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <SimpleGrid cols={2}>
            <NativeSelect label="Channel" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.currentTarget.value })} data={toOptions(CHANNELS)} />
            <NativeSelect label="Default category" value={draft.defaultCategory} onChange={(e) => setDraft({ ...draft, defaultCategory: e.currentTarget.value })} data={toOptions(categories)} />
            <NativeSelect label="Default queue" value={draft.defaultQueue} onChange={(e) => setDraft({ ...draft, defaultQueue: e.currentTarget.value })} data={toOptions(queues)} />
            <NativeSelect label="Default priority" value={draft.defaultPriority} onChange={(e) => setDraft({ ...draft, defaultPriority: e.currentTarget.value })} data={toOptions(PRIORITIES)} />
            <TextInput label="Branch code" required value={draft.branchCode} onChange={(e) => setDraft({ ...draft, branchCode: e.currentTarget.value })} />
          </SimpleGrid>
          <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
        </EditorModal>
      )}
    </SectionCard>
  );
}
