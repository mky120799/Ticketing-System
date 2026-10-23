import { Alert, Button, Group, Text } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { reauthenticate } from '../auth';
import { useSession } from '../session/session-provider';

/**
 * Step-up authentication: some actions (revealing a customer reference, approving, legal holds, exports) need a
 * recent sign-in. When the API refuses one for that reason, this banner offers a fresh sign-in, after which the
 * person returns to the same page and can repeat the action.
 */
export function StepUpBanner() {
  const { stepUpRequired, dismissStepUp } = useSession();
  if (!stepUpRequired) return null;
  return (
    <Alert color="yellow" icon={<IconLock size={18} />} mb="lg" title="Please confirm it is you" role="alert">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text size="sm">This action needs a recent sign-in. Sign in again, then repeat the action.</Text>
        <Group gap="xs">
          <Button size="xs" onClick={() => void reauthenticate()}>Sign in again</Button>
          <Button size="xs" variant="subtle" onClick={dismissStepUp}>Dismiss</Button>
        </Group>
      </Group>
    </Alert>
  );
}
