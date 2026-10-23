/**
 * The bell in the header: unread count plus a drop-down inbox.
 * A notification carries only a title and a ticket ID. Opening one goes to the ticket's page, which loads it
 * through the normal access-checked API, so a notification can never show more than the person may see.
 */
import { ActionIcon, Button, Group, Indicator, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getNotifications, markNotificationsRead } from '../api';
import { formatRelative } from '../lib/format';
import { queryKeys } from '../lib/query-keys';
import { useSignedInUser } from '../session/session-provider';
import { EmptyState } from '../components/states';

export function NotificationMenu() {
  const user = useSignedInUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [opened, { toggle, close }] = useDisclosure(false);

  // Refreshed by live updates (a "notification" event invalidates this key), so no polling is needed.
  const { data } = useQuery({ queryKey: queryKeys.notifications, queryFn: () => getNotifications(user) });
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(user, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
  });

  const open = (ticketId: string | null, id: string) => {
    close();
    markRead.mutate([id]);
    if (ticketId) navigate(`/tickets/${ticketId}`);
  };

  return (
    <Popover opened={opened} onChange={(next) => { if (!next) close(); }} position="bottom-end" width={360} shadow="md">
      {/* The button must be the Target's direct child: Mantine puts aria-haspopup/aria-expanded on that element. */}
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggle} aria-label={`Notifications, ${unread} unread`} style={{ overflow: 'visible' }}>
          <Indicator label={unread > 99 ? '99+' : unread} size={18} disabled={unread === 0} color="red" offset={2}>
            <IconBell size={20} />
          </Indicator>
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <Text fw={600}>Notifications</Text>
          <Button variant="subtle" size="compact-xs" disabled={!unread} onClick={() => markRead.mutate(undefined)}>Mark all read</Button>
        </Group>
        <ScrollArea.Autosize mah={380}>
          {data?.notifications.length ? (
            <Stack gap={0}>
              {data.notifications.map((n) => (
                <UnstyledButton key={n.id} onClick={() => open(n.ticketId, n.id)} px="md" py="sm" className="notification-item" data-unread={!n.read || undefined}>
                  <Text size="sm" fw={n.read ? 400 : 600}>{n.title}</Text>
                  <Text size="xs" c="dimmed">{formatRelative(n.createdAt)}</Text>
                </UnstyledButton>
              ))}
            </Stack>
          ) : <EmptyState title="You are all caught up" />}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
