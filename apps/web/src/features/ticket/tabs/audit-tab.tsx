/**
 * Auditor view of one ticket's audit trail.
 *
 * Each event stores a hash of its content plus the hash of the event before it, forming a chain: changing any
 * old event would break every hash after it, so tampering is detectable. The short hashes are shown so an
 * auditor can see the chain links. Opening this tab and exporting are themselves written to the audit trail.
 */
import { Badge, Button, Code, Group, Stack, Text, Timeline } from '@mantine/core';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { exportAuditTrail, getAuditTrail } from '../../../api';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../../components/states';
import { PersonName } from '../../../components/person-name';
import { formatDateTime } from '../../../lib/format';
import { notifySuccess } from '../../../lib/notify';
import { queryKeys } from '../../../lib/query-keys';
import { useSignedInUser } from '../../../session/session-provider';

export function AuditTab({ ticketId }: { ticketId: string }) {
  const user = useSignedInUser();
  const trail = useQuery({ queryKey: queryKeys.ticketAudit(ticketId), queryFn: () => getAuditTrail(user, ticketId), staleTime: 0 });
  const exportJson = useMutation({ mutationFn: () => exportAuditTrail(user, ticketId), onSuccess: () => notifySuccess('Audit trail exported') });

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Viewing and exporting this trail are recorded too.</Text>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={trail.isFetching} onClick={() => void trail.refetch()}>Refresh</Button>
          <Button size="xs" variant="light" leftSection={<IconDownload size={14} />} loading={exportJson.isPending} onClick={() => exportJson.mutate()}>Export JSON</Button>
        </Group>
      </Group>
      {trail.isPending ? <LoadingBlock rows={6} />
        : trail.isError ? <ErrorBlock error={trail.error} onRetry={() => void trail.refetch()} />
        : trail.data.events.length === 0 ? <EmptyState title="No audit events" />
        : (
          <Timeline bulletSize={14} lineWidth={2}>
            {trail.data.events.map((event) => (
              <Timeline.Item key={event.id} color={event.outcome === 'denied' ? 'red' : 'bank'}
                title={<Group gap="xs"><Text size="sm" fw={600} ff="monospace">{event.action}</Text>{event.outcome !== 'success' && <Badge size="xs" color="red" variant="light">{event.outcome}</Badge>}</Group>}>
                <Text size="xs" c="dimmed"><PersonName id={event.actorId} size="xs" c="dimmed" /> · {formatDateTime(event.occurredAt)}</Text>
                <Text size="xs" c="dimmed">hash <Code>{event.eventHash.slice(0, 12)}…</Code> ← <Code>{event.previousHash ? `${event.previousHash.slice(0, 12)}…` : 'start'}</Code></Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
    </Stack>
  );
}
