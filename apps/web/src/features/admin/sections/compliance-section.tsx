/**
 * Compliance configuration.
 *   - Regulatory profiles: jurisdiction rules as data. A category linked to a profile makes its tickets complaints
 *     with these clocks (e.g. Australian RG 271: acknowledge in 1 business day, final response in 30 days).
 *   - Public holidays: excluded when counting business days for those clocks (weekends always are).
 */
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Group, NumberInput, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { getHolidays, getRegulatoryProfiles, saveHoliday, saveRegulatoryProfile, type Holiday, type RegulatoryProfile } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { formatDate } from '../../../lib/format';
import { ActiveBadge, EditButton, EditorModal, KEY_PATTERN, useConfigList, useConfigSave } from '../admin-kit';

export function ComplianceSection() {
  return <Stack gap="lg"><RegulatoryProfiles /><PublicHolidays /></Stack>;
}

function RegulatoryProfiles() {
  const profiles = useConfigList('regulatory-profiles', getRegulatoryProfiles);
  const blank: RegulatoryProfile = { profileKey: '', label: '', jurisdiction: 'AU', acknowledgeBusinessDays: 1, finalResponseCalendarDays: 30, atRiskDays: 5, active: true };
  const [draft, setDraft] = useState<RegulatoryProfile | null>(null);
  const save = useConfigSave(saveRegulatoryProfile, ['regulatory-profiles'], (p) => `Profile "${p.profileKey}" saved`);

  return (
    <SectionCard title="Regulatory profiles" description="Complaint clocks per jurisdiction. Linking a category to a profile makes its tickets complaints automatically."
      actions={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setDraft(blank)}>New profile</Button>}>
      {profiles.isPending ? <LoadingBlock rows={3} /> : !profiles.data?.length ? <EmptyState title="No profiles for your jurisdiction" /> : (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Profile</Table.Th><Table.Th>Acknowledge</Table.Th><Table.Th>Final response</Table.Th><Table.Th>At risk</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {profiles.data.map((p) => (
                <Table.Tr key={p.profileKey}>
                  <Table.Td><Text size="sm" fw={500}>{p.profileKey} <Text span size="xs" c="dimmed">({p.jurisdiction})</Text></Text><Text size="xs" c="dimmed" lineClamp={2}>{p.label}</Text></Table.Td>
                  <Table.Td>{p.acknowledgeBusinessDays} business day(s)</Table.Td>
                  <Table.Td>{p.finalResponseCalendarDays} days</Table.Td>
                  <Table.Td>last {p.atRiskDays} days</Table.Td>
                  <Table.Td><ActiveBadge active={p.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${p.profileKey}`} onClick={() => setDraft(p)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal title={draft.profileKey ? `Profile: ${draft.profileKey}` : 'New regulatory profile'} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <SimpleGrid cols={2}>
            <TextInput label="Profile key" required pattern={KEY_PATTERN} value={draft.profileKey} onChange={(e) => setDraft({ ...draft, profileKey: e.currentTarget.value })} />
            <TextInput label="Jurisdiction" description="Two-letter country code" required maxLength={2} value={draft.jurisdiction} onChange={(e) => setDraft({ ...draft, jurisdiction: e.currentTarget.value.toUpperCase() })} />
          </SimpleGrid>
          <TextInput label="Label" required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })} />
          <SimpleGrid cols={3}>
            <NumberInput label="Acknowledge within (business days)" min={0} max={30} value={draft.acknowledgeBusinessDays} onChange={(v) => setDraft({ ...draft, acknowledgeBusinessDays: Number(v) || 0 })} />
            <NumberInput label="Final response within (days)" min={1} max={365} value={draft.finalResponseCalendarDays} onChange={(v) => setDraft({ ...draft, finalResponseCalendarDays: Number(v) || 1 })} />
            <NumberInput label="At risk in the last (days)" min={0} max={60} value={draft.atRiskDays} onChange={(v) => setDraft({ ...draft, atRiskDays: Number(v) || 0 })} />
          </SimpleGrid>
          <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
        </EditorModal>
      )}
    </SectionCard>
  );
}

function PublicHolidays() {
  const holidays = useConfigList('holidays', getHolidays);
  const [draft, setDraft] = useState<Holiday>({ date: '', name: '' });
  const save = useConfigSave(saveHoliday, ['holidays'], (h) => `${h.name} added`);
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(draft, { onSuccess: () => setDraft({ date: '', name: '' }) }); };

  return (
    <SectionCard title="Public holidays" description="Excluded from business-day deadlines. Weekends are always excluded.">
      {holidays.isPending ? <LoadingBlock rows={3} /> : !holidays.data?.length ? <EmptyState title="No public holidays entered" /> : (
        <Table verticalSpacing="xs" maw={560}>
          <Table.Thead><Table.Tr><Table.Th>Date</Table.Th><Table.Th>Holiday</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{holidays.data.map((h) => <Table.Tr key={h.date}><Table.Td>{formatDate(h.date)}</Table.Td><Table.Td>{h.name}</Table.Td></Table.Tr>)}</Table.Tbody>
        </Table>
      )}
      <form onSubmit={submit}>
        <Group align="flex-end" gap="sm">
          <TextInput type="date" label="Date" required value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.currentTarget.value })} />
          <TextInput label="Name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} style={{ flex: '1 1 200px' }} />
          <Button type="submit" loading={save.isPending}>Add holiday</Button>
        </Group>
      </form>
    </SectionCard>
  );
}
