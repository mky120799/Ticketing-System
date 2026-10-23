/**
 * Integration events: health of the outbox.
 *
 * The "outbox pattern": when a ticket changes, the event for the bank's systems is saved in the same database
 * transaction as the change, then a worker publishes it to the message bus. If the bus is down, events retry;
 * after five failures they become "dead letters" and wait here. Fix the cause, then replay them.
 */
import { Alert, Button, Group, SimpleGrid, Table, Text } from '@mantine/core';
import { IconCheck, IconPlayerPlay } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { getDeadLetters, getOutboxSummary, replayAllDeadLetters, replayDeadLetter } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { LoadingBlock } from '../../../components/states';
import { formatDateTime, humanize } from '../../../lib/format';
import { StatTileSmall } from './stat-tile-small';
import { useConfigList, useConfigSave } from '../admin-kit';

const STATES = ['pending', 'retry', 'in_flight', 'dead_letter', 'published'] as const;

export function IntegrationSection() {
  const queryClient = useQueryClient();
  const summary = useConfigList('outbox-summary', getOutboxSummary);
  const dead = useConfigList('dead-letters', getDeadLetters);
  const replay = useConfigSave((user, id: string | null) => (id ? replayDeadLetter(user, id) : replayAllDeadLetters(user)), ['outbox-summary', 'dead-letters'], (id) => (id ? 'Event queued for replay' : 'All failed events queued for replay'));
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['config', 'outbox-summary'] }); void queryClient.invalidateQueries({ queryKey: ['config', 'dead-letters'] }); };

  return (
    <SectionCard title="Integration events" description="Events leave the platform through a reliable queue. Failed events wait here until replayed."
      actions={<Button size="xs" variant="default" onClick={refresh}>Refresh</Button>}>
      {summary.isPending ? <LoadingBlock rows={2} /> : (
        <SimpleGrid cols={{ base: 2, sm: 5 }}>
          {STATES.map((s) => <StatTileSmall key={s} label={humanize(s)} value={summary.data?.[s] ?? 0} alert={s === 'dead_letter' && Boolean(summary.data?.[s])} />)}
        </SimpleGrid>
      )}
      {dead.isPending ? <LoadingBlock rows={3} /> : !dead.data?.length ? (
        <Alert color="green" variant="light" icon={<IconCheck size={16} />}>No failed events.</Alert>
      ) : (
        <>
          <Group justify="space-between">
            <Text size="sm" fw={600}>{dead.data.length} failed event(s)</Text>
            <Button size="xs" leftSection={<IconPlayerPlay size={14} />} loading={replay.isPending} onClick={() => replay.mutate(null)}>Replay all</Button>
          </Group>
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs">
              <Table.Thead><Table.Tr><Table.Th>Event</Table.Th><Table.Th>About</Table.Th><Table.Th>Attempts</Table.Th><Table.Th>Last error</Table.Th><Table.Th>Created</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {dead.data.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td><Text size="sm" ff="monospace">{e.eventType}</Text></Table.Td>
                    <Table.Td><Text size="sm">{e.aggregateType} {e.aggregateId.slice(0, 8)}</Text></Table.Td>
                    <Table.Td>{e.attempts}</Table.Td>
                    <Table.Td><Text size="sm" c="red" lineClamp={2}>{e.lastError ?? 'failed'}</Text></Table.Td>
                    <Table.Td><Text size="sm">{formatDateTime(e.createdAt)}</Text></Table.Td>
                    <Table.Td ta="right"><Button size="compact-xs" variant="subtle" onClick={() => replay.mutate(e.id)}>Replay</Button></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}
    </SectionCard>
  );
}
