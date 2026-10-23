import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

/**
 * The top of every page: a title (the page's single <h1>, which screen readers use to announce the page),
 * an optional one-line description, and actions on the right.
 */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
      <Stack gap={4}>
        <Title order={1} size="h2">{title}</Title>
        {description && <Text c="dimmed" size="sm">{description}</Text>}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
