/**
 * The three states every piece of loaded data can be in, drawn consistently:
 *   - loading → grey placeholder blocks (skeletons) roughly the shape of the content, so the page does not jump,
 *   - failed  → a red box saying what went wrong, with a "Try again" button,
 *   - empty   → a friendly sentence instead of a blank space.
 */
import type { ReactNode } from 'react';
import { Alert, Button, Center, Skeleton, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconAlertTriangle, IconInbox } from '@tabler/icons-react';
import { errorMessage } from '../lib/format';

export function LoadingBlock({ rows = 4, height = 18 }: { rows?: number; height?: number }) {
  return (
    // role="status" makes screen readers announce "Loading…" (a plain div may not carry an aria-label).
    <Stack gap="sm" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={height} radius="sm" width={index === rows - 1 ? '60%' : '100%'} />)}
    </Stack>
  );
}

export function ErrorBlock({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title={title} role="alert">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry && <Button size="xs" variant="outline" color="red" onClick={onRetry}>Try again</Button>}
      </Stack>
    </Alert>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <Center py="xl">
      <Stack align="center" gap="xs" maw={420} ta="center">
        <ThemeIcon variant="light" color="gray" size={44} radius="xl">{icon ?? <IconInbox size={24} />}</ThemeIcon>
        <Text fw={600}>{title}</Text>
        {description && <Text size="sm" c="dimmed">{description}</Text>}
        {action}
      </Stack>
    </Center>
  );
}
