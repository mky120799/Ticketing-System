/**
 * Service levels: response and resolution targets per priority, and the working hours "business hours" targets use.
 *   - Wall clock counts every minute; business hours counts only working time in the bank's time zone.
 *   - "Pause while waiting for the customer" stops the clock in the Waiting on customer status.
 */
import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, Group, NativeSelect, NumberInput, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { getBusinessHours, getSlaPolicies, saveBusinessHours, saveSlaPolicy, type BusinessHours, type SlaPolicy } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { humanize } from '../../../lib/format';
import { ActiveBadge, EditButton, EditorModal, useConfigList, useConfigSave } from '../admin-kit';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Minutes since midnight ⇄ "HH:MM" for <input type="time">. */
const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const toMinute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** 90 → "1 h 30 min", 2880 → "2 d". Easier to read than raw minutes. */
function duration(minutes: number): string {
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ') || '0 min';
}

export function ServiceLevelsSection() {
  return <Stack gap="lg"><SlaPolicies /><WorkingHours /></Stack>;
}

function SlaPolicies() {
  const policies = useConfigList('sla', getSlaPolicies);
  const [draft, setDraft] = useState<SlaPolicy | null>(null);
  const save = useConfigSave(saveSlaPolicy, ['sla'], (p) => `${humanize(p.priority)} targets saved`);

  return (
    <SectionCard title="SLA policies" description="Targets for the first response and for resolution, by priority.">
      {policies.isPending ? <LoadingBlock rows={4} /> : !policies.data?.length ? <EmptyState title="No SLA policies" /> : (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Policy</Table.Th><Table.Th>Priority</Table.Th><Table.Th>First response</Table.Th><Table.Th>Resolution</Table.Th><Table.Th>Counts</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {policies.data.map((p) => (
                <Table.Tr key={`${p.policyKey}${p.priority}`}>
                  <Table.Td>{p.policyKey}</Table.Td>
                  <Table.Td><Text size="sm" fw={500}>{humanize(p.priority)}</Text></Table.Td>
                  <Table.Td>{duration(p.firstResponseMinutes)}</Table.Td>
                  <Table.Td>{duration(p.resolutionMinutes)}</Table.Td>
                  <Table.Td><Text size="sm">{p.calendar === 'business' ? 'Business hours' : 'Wall clock'}{p.pauseWhilePendingCustomer ? ', pauses for customer' : ''}</Text></Table.Td>
                  <Table.Td><ActiveBadge active={p.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${p.priority} policy`} onClick={() => setDraft(p)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal title={`SLA: ${draft.policyKey} · ${humanize(draft.priority)}`} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <SimpleGrid cols={2}>
            <NumberInput label="First response (minutes)" description={duration(draft.firstResponseMinutes)} min={1} value={draft.firstResponseMinutes} onChange={(v) => setDraft({ ...draft, firstResponseMinutes: Number(v) || 1 })} />
            <NumberInput label="Resolution (minutes)" description={duration(draft.resolutionMinutes)} min={1} value={draft.resolutionMinutes} onChange={(v) => setDraft({ ...draft, resolutionMinutes: Number(v) || 1 })} />
          </SimpleGrid>
          <NativeSelect label="Counts" value={draft.calendar} onChange={(e) => setDraft({ ...draft, calendar: e.currentTarget.value as 'wall' | 'business' })} data={[{ value: 'wall', label: 'Wall clock (every minute)' }, { value: 'business', label: 'Business hours only' }]} />
          <Checkbox label="Pause while waiting for the customer" checked={draft.pauseWhilePendingCustomer} onChange={(e) => setDraft({ ...draft, pauseWhilePendingCustomer: e.currentTarget.checked })} />
          <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
        </EditorModal>
      )}
    </SectionCard>
  );
}

function WorkingHours() {
  const saved = useConfigList('business-hours', getBusinessHours);
  const [hours, setHours] = useState<BusinessHours | null>(null);
  useEffect(() => { if (saved.data) setHours(saved.data); }, [saved.data]);
  const save = useConfigSave(saveBusinessHours, ['business-hours'], () => 'Business hours saved');

  return (
    <SectionCard title="Business hours" description="Used by policies that count business hours, for your country. Public holidays are under Compliance.">
      {saved.isPending ? <LoadingBlock rows={3} /> : !hours ? <EmptyState title="No business hours set for your country yet" /> : (
        <Stack gap="md" maw={560}>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput label="Time zone" required value={hours.timezone} onChange={(e) => setHours({ ...hours, timezone: e.currentTarget.value })} placeholder="Australia/Sydney" />
            <TextInput type="time" label="Opens" required value={toTime(hours.startMinute)} onChange={(e) => setHours({ ...hours, startMinute: toMinute(e.currentTarget.value) })} />
            {/* 1440 (midnight at the end of the day) cannot be typed into a time input, so it is shown as 23:59. */}
            <TextInput type="time" label="Closes" required value={toTime(hours.endMinute === 1440 ? 1439 : hours.endMinute)} onChange={(e) => setHours({ ...hours, endMinute: toMinute(e.currentTarget.value) })} />
          </SimpleGrid>
          <Stack gap={6}>
            <Text size="sm" fw={500} id="working-days-label">Working days</Text>
            <Chip.Group multiple value={hours.workingDays.map(String)} onChange={(values) => setHours({ ...hours, workingDays: values.map(Number).sort() })}>
              <Group gap="xs" role="group" aria-labelledby="working-days-label">{DAYS.map((day, index) => <Chip key={day} value={String(index)} size="sm">{day}</Chip>)}</Group>
            </Chip.Group>
          </Stack>
          <Group><Button loading={save.isPending} onClick={() => save.mutate(hours)}>Save business hours</Button></Group>
        </Stack>
      )}
    </SectionCard>
  );
}
