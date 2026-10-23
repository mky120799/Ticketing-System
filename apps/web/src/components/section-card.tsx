import type { ReactNode } from 'react';
import { Group, Paper, Stack, Text, Title } from '@mantine/core';

/**
 * A titled white panel. Most of the console is built from these: a heading (an <h2> by default so the page
 * outline stays correct for screen readers), an optional explanation, optional actions, then the content.
 */
export function SectionCard({ title, description, actions, children, order = 2 }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; order?: 2 | 3 }) {
  return (
    <Paper p="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
          <Stack gap={2}>
            <Title order={order} size="h4">{title}</Title>
            {description && <Text size="sm" c="dimmed">{description}</Text>}
          </Stack>
          {actions && <Group gap="xs">{actions}</Group>}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}
