import { Badge, Group, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import type { RequestSummary } from '../api';

const KIND_LABEL = { complaint: 'Complaint', correction: 'Correction request', request: 'Request' } as const;

/**
 * Everything the customer has raised, newest first. Each entry is a button that opens the request on the right;
 * `aria-current` tells screen readers which one is open.
 */
export function RequestHistory({ requests, selectedId, onOpen }: { requests: RequestSummary[]; selectedId?: string; onOpen: (id: string) => void }) {
  return (
    <Paper p="lg" component="section" aria-labelledby="list-heading">
      <Title order={2} size="h3" id="list-heading" mb="md">Your history</Title>
      {requests.length === 0 ? <Text c="dimmed">You have not raised anything yet.</Text> : (
        <Stack gap="xs" component="ul" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {requests.map((item) => (
            <li key={item.id}>
              <UnstyledButton onClick={() => onOpen(item.id)} aria-current={selectedId === item.id} className="history-item" p="sm" w="100%">
                <Text fw={600}>{item.subject}</Text>
                <Group gap={6} mt={4}>
                  <Badge size="sm" variant="light" color={item.kind === 'complaint' ? 'orange' : 'gray'}>{KIND_LABEL[item.kind ?? 'request']}</Badge>
                  <Text size="sm" c="dimmed">{item.reference} · {item.status}</Text>
                </Group>
                <Text size="xs" c="dimmed" mt={2}>Raised {new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</Text>
              </UnstyledButton>
            </li>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
