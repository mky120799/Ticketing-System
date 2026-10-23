/**
 * The frame around every signed-in page (Mantine "AppShell"):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ header: brand · live status · notifications · user menu      │
 *   ├────────────┬─────────────────────────────────────────────────┤
 *   │ navigation │ page content (<Outlet/> = the current route)    │
 *   │ (by role)  │                                                 │
 *   └────────────┴─────────────────────────────────────────────────┘
 *
 * On narrow screens the navigation collapses behind a "burger" button.
 */
import { AppShell, Avatar, Badge, Box, Burger, Group, Menu, NavLink, ScrollArea, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBuildingBank, IconChartBar, IconChevronDown, IconLogout, IconSettings, IconShieldCheck, IconTicket } from '@tabler/icons-react';
import { NavLink as RouterNavLink, Outlet, useLocation } from 'react-router-dom';
import { signOut } from '../auth';
import { humanize } from '../lib/format';
import { useLiveUpdates } from '../live/use-live-updates';
import { useSession } from '../session/session-provider';
import type { Capability } from '../session/roles';
import { NotificationMenu } from './notification-menu';
import { StepUpBanner } from './step-up-banner';

/** Navigation entries. Each is shown only to roles with the matching capability. */
const NAV: { to: string; label: string; icon: typeof IconTicket; capability: Capability }[] = [
  { to: '/tickets', label: 'Tickets', icon: IconTicket, capability: 'readCases' },
  { to: '/dashboard', label: 'Dashboard', icon: IconChartBar, capability: 'viewDashboard' },
  { to: '/audit', label: 'Audit', icon: IconShieldCheck, capability: 'viewAudit' },
  { to: '/admin', label: 'Administration', icon: IconSettings, capability: 'administer' }
];

export function AppLayout() {
  const { user, profile, roles, can } = useSession();
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const location = useLocation();
  // Administrators have no case access, so they get neither the live feed nor notifications.
  const caseWorker = can('readCases');
  const live = useLiveUpdates(user, caseWorker);
  const name = String(user?.profile.preferred_username ?? user?.profile.name ?? user?.profile.sub ?? 'Signed in');

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 232, breakpoint: 'sm', collapsed: { mobile: !navOpened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <ThemeIcon size="lg" radius="md" aria-hidden><IconBuildingBank size={20} /></ThemeIcon>
            <Box visibleFrom="xs">
              <Text fw={700} lh={1.1}>Bank Case Platform</Text>
              <Text size="xs" c="dimmed" lh={1.1}>Secure case management</Text>
            </Box>
          </Group>

          <Group gap="sm" wrap="nowrap">
            {caseWorker && (
              <Tooltip label={live ? 'Changes by colleagues appear automatically' : 'Reconnecting: data may be out of date'}>
                <Badge variant="dot" color={live ? 'green' : 'gray'} size="lg" tt="none">{live ? 'Live' : 'Offline'}</Badge>
              </Tooltip>
            )}
            {caseWorker && <NotificationMenu />}
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <UnstyledButton aria-label={`Account menu for ${name}`}>
                  <Group gap={8} wrap="nowrap">
                    <Avatar size="sm" color="bank" radius="xl">{name.slice(0, 2).toUpperCase()}</Avatar>
                    <Text size="sm" fw={500} visibleFrom="sm">{name}</Text>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Roles</Menu.Label>
                <Box px="sm" pb="xs"><Text size="sm">{roles.map(humanize).join(', ') || '—'}</Text></Box>
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void signOut()}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm" aria-label="Main navigation">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap={4}>
            {NAV.filter((item) => can(item.capability)).map((item) => (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={18} />}
                // "Tickets" stays highlighted on a ticket's own page (/tickets/123).
                active={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)}
                onClick={closeNav}
                styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
              />
            ))}
          </Stack>
        </AppShell.Section>
        {/* The person's organisational scope: explains why they see some tickets and not others. */}
        {profile && (
          <AppShell.Section pt="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
            <Text size="xs" c="dimmed">Scope</Text>
            <Text size="xs">Branch {profile.branch} · {profile.legalEntity} / {profile.country}</Text>
            <Text size="xs" c="dimmed" lineClamp={2}>Queues: {profile.queues.join(', ')}</Text>
          </AppShell.Section>
        )}
      </AppShell.Navbar>

      <AppShell.Main bg="gray.0">
        <StepUpBanner />
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
