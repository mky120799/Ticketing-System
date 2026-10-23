/**
 * The signed-in customer portal.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ header: bank name · your name · Sign out                 │
 *   ├────────────────────┬─────────────────────────────────────┤
 *   │ Tell us what       │ The request you picked:             │
 *   │ happened (form)    │ status, updates, reply, documents   │
 *   │ Your history       │                                     │
 *   └────────────────────┴─────────────────────────────────────┘
 *
 * The portal is small, so it keeps its data in plain React state rather than a query cache.
 * Wording is plain English for the public: no internal codes, no jargon.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppShell, Button, Center, Container, Grid, Group, Loader, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBuildingBank, IconCircleCheck } from '@tabler/icons-react';
import type { User } from 'oidc-client-ts';
import { signIn, signOut } from './auth';
import { getRequest, listRequests, type RequestDetail as Detail, type RequestSummary } from './api';
import { usePortalSession } from './session';
import { NewRequestForm } from './components/new-request-form';
import { RequestHistory } from './components/request-history';
import { RequestDetail } from './components/request-detail';

export function App() {
  const { user, ready, error } = usePortalSession();
  if (!ready) return <Center mih="100vh" component="main"><Loader aria-label="Loading" /></Center>;
  if (!user) return <SignInPage error={error} />;
  return <Portal user={user} />;
}

function SignInPage({ error }: { error: string }) {
  return (
    <Center mih="100vh" p="md" component="main" bg="gray.0">
      <Paper p="xl" maw={480} w="100%" shadow="sm">
        <Stack gap="md">
          <ThemeIcon size={48} radius="md" aria-hidden><IconBuildingBank size={28} /></ThemeIcon>
          <Title order={1}>Make a request or complaint</Title>
          <Text>Sign in to raise a request or complaint with us and to follow its progress.</Text>
          {error && <Alert color="red" role="alert">{error}</Alert>}
          <Button size="md" onClick={() => void signIn()}>Sign in</Button>
          <Text size="sm" c="dimmed">We will never ask for your PIN or password in this portal.</Text>
        </Stack>
      </Paper>
    </Center>
  );
}

/** The feedback line under the header: a confirmation (green) or a problem (red). Announced to screen readers. */
export type Feedback = { kind: 'notice' | 'error'; text: string } | null;

function Portal({ user }: { user: User }) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const fail = useCallback((e: unknown) => setFeedback({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' }), []);
  const refresh = useCallback(() => { void listRequests(user).then(setRequests).catch(fail); }, [user, fail]);
  useEffect(refresh, [refresh]);

  /** Opens a request and moves keyboard focus to its heading, so screen-reader users hear what opened. */
  const open = useCallback(async (id: string) => {
    try { setSelected(await getRequest(user, id)); setTimeout(() => heading.current?.focus(), 0); }
    catch (e) { fail(e); }
  }, [user, fail]);

  const name = String(user.profile.preferred_username ?? user.profile.name ?? 'You');

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size="lg" radius="md" aria-hidden><IconBuildingBank size={20} /></ThemeIcon>
              <Text fw={700}>Customer help</Text>
            </Group>
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" visibleFrom="xs">{name}</Text>
              <Button variant="default" size="sm" onClick={() => void signOut()}>Sign out</Button>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main bg="gray.0">
        <Container size="lg" py="md">
          <Title order={1} mb="md">Your requests and complaints</Title>
          <div aria-live="polite">
            {feedback && (
              <Alert mb="md" color={feedback.kind === 'error' ? 'red' : 'green'} icon={feedback.kind === 'notice' ? <IconCircleCheck size={18} /> : undefined}
                role={feedback.kind === 'error' ? 'alert' : undefined} withCloseButton onClose={() => setFeedback(null)} closeButtonLabel="Dismiss message">
                {feedback.text}
              </Alert>
            )}
          </div>
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack gap="lg">
                <NewRequestForm user={user} onCreated={(id, message) => { setFeedback({ kind: 'notice', text: message }); refresh(); void open(id); }} onError={fail} />
                <RequestHistory requests={requests} selectedId={selected?.id} onOpen={(id) => void open(id)} />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <RequestDetail user={user} request={selected} headingRef={heading}
                onChanged={(message) => { setFeedback({ kind: 'notice', text: message }); if (selected) void open(selected.id); }} onError={fail} />
            </Grid.Col>
          </Grid>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
