/** Whole-page states: loading, page not found, no access, and a profile that could not be loaded. */
import { Button, Center, Loader, Stack, Text, Title } from '@mantine/core';
import { IconLock, IconMapOff } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { signOut } from '../auth';
import { EmptyState } from '../components/states';

export function FullPageLoader() {
  return <Center mih="100vh" component="main"><Loader aria-label="Loading" /></Center>;
}

export function NotFoundPage() {
  return (
    <>
      <Title order={1} className="sr-only">Page not found</Title>
      <EmptyState icon={<IconMapOff size={24} />} title="Page not found" description="The address may be mistyped, or the page has moved." action={<Button component={Link} to="/" variant="light">Go to your home screen</Button>} />
    </>
  );
}

export function NoAccessPage() {
  return (
    <>
      <Title order={1} className="sr-only">No access</Title>
      <EmptyState icon={<IconLock size={24} />} title="You do not have access to this screen" description="Access follows the roles your bank gave you. Ask your team lead if you think you need it." action={<Button component={Link} to="/" variant="light">Go to your home screen</Button>} />
    </>
  );
}

/** Signed in, but `/me` failed: usually an account without a role or scope in the identity provider. */
export function ProfileErrorPage({ message }: { message: string }) {
  return (
    <Center mih="100vh" component="main" p="md">
      <Stack align="center" maw={440} ta="center">
        <Title order={1} size="h3">We could not load your profile</Title>
        <Text c="dimmed">{message}</Text>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </Stack>
    </Center>
  );
}
