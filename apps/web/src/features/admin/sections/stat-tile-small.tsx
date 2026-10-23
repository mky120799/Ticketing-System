import { Paper, Text } from '@mantine/core';

/** A compact count with its label, used for outbox states. Red only when something needs attention. */
export function StatTileSmall({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <Paper p="sm" bg={alert ? 'red.0' : 'gray.0'}>
      <Text size="xs" c="dimmed" fw={600}>{label}</Text>
      <Text fz={22} fw={700} c={alert ? 'red' : undefined}>{value}</Text>
    </Paper>
  );
}
