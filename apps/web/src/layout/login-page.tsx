import { Alert, Button, Center, List, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBuildingBank, IconLock } from '@tabler/icons-react';
import { signIn } from '../auth';
import { useSession } from '../session/session-provider';

/**
 * Shown to anyone not signed in, whatever page they asked for. Signing in remembers that page and returns to it,
 * so a link to /tickets/123 shared in chat still works after sign-in.
 */
export function LoginPage() {
  const { error } = useSession();
  return (
    <Center mih="100vh" bg="gray.0" p="md" component="main">
      <Paper p="xl" maw={460} w="100%" shadow="sm">
        <Stack gap="lg">
          <ThemeIcon size={48} radius="md" aria-hidden><IconBuildingBank size={28} /></ThemeIcon>
          <Stack gap={4}>
            <Text size="xs" fw={700} c="bank" tt="uppercase" style={{ letterSpacing: '0.12em' }}>Secure case management</Text>
            <Title order={1}>Bank Case Platform</Title>
          </Stack>
          <Text c="dimmed">Sign in using your bank-managed identity. This application never handles passwords.</Text>
          <List size="sm" spacing={4} c="dimmed" icon={<IconLock size={14} />}>
            <List.Item>Customer references are masked by default.</List.Item>
            <List.Item>Every view and change is written to a tamper-evident audit trail.</List.Item>
          </List>
          {error && <Alert color="red" role="alert">{error}</Alert>}
          <Button size="md" onClick={() => void signIn()}>Sign in with SSO</Button>
        </Stack>
      </Paper>
    </Center>
  );
}
