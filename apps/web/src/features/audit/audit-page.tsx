/**
 * Auditor console.
 *
 * Left: integrity of the whole audit trail. Events are hash-chained (each one includes the hash of the one before),
 * so any edit to history breaks the chain. "Verify" recomputes the hashes; "anchors" are chain heads published
 * outside the database so even a database administrator cannot rewrite history unnoticed.
 *
 * Right: search across audit events for tickets in the auditor's scope. Every search is itself audited.
 */
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Code, Drawer, Grid, Group, NativeSelect, ScrollArea, SimpleGrid, Stack, Table, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconSearch, IconShieldCheck, IconShieldX } from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getChainStatus, searchAudit, verifyChain, type AuditFilters, type AuditSearchEvent } from '../../api';
import { PageHeader } from '../../components/page-header';
import { SectionCard } from '../../components/section-card';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../components/states';
import { PersonName } from '../../components/person-name';
import { formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { useSignedInUser } from '../../session/session-provider';

const EMPTY_FILTERS = { actor: '', action: '', outcome: '', from: '', to: '' };

export default function AuditPage() {
  return (
    <>
      <PageHeader title="Audit" description="Tamper-evident record of every view and change. Auditors can read everything in scope and change nothing." />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 4 }}><ChainIntegrity /></Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}><AuditSearch /></Grid.Col>
      </Grid>
    </>
  );
}

function ChainIntegrity() {
  const user = useSignedInUser();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.chainStatus, queryFn: () => getChainStatus(user) });
  const verify = useMutation({
    mutationFn: (full: boolean) => verifyChain(user, full),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chainStatus })
  });
  const v = status.data?.verification;
  const anchor = status.data?.lastAnchor;

  return (
    <SectionCard title="Audit trail integrity">
      {status.isPending ? <LoadingBlock rows={3} /> : status.isError ? <ErrorBlock error={status.error} onRetry={() => void status.refetch()} /> : (
        <Stack gap="md">
          {v ? (
            <Group gap="md" wrap="nowrap">
              <ThemeIcon size={48} radius="xl" color={v.status === 'valid' ? 'green' : 'red'} aria-hidden>{v.status === 'valid' ? <IconShieldCheck size={28} /> : <IconShieldX size={28} />}</ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} c={v.status === 'valid' ? 'green' : 'red'}>{v.status === 'valid' ? 'Chain verified' : 'INTEGRITY FAILURE'}</Text>
                <Text size="xs" c="dimmed">Through event {v.verifiedThroughSequence} · {formatDateTime(v.verifiedAt)}</Text>
              </Stack>
            </Group>
          ) : <Text size="sm">No verification has run yet.</Text>}
          {v?.status === 'invalid' && (
            <Alert color="red" title={`Broken at event ${v.failureSequence}`}>{v.failureReason}. Escalate to security immediately and do not modify the database.</Alert>
          )}
          {v && <Text size="sm" c="dimmed">{v.eventsChecked} events checked in the last run{v.legacyEvents ? `; ${v.legacyEvents} older events were link-checked only` : ''}.</Text>}
          <Text size="sm" c="dimmed">{anchor ? <>Last published anchor: event {anchor.sequence}, {formatDateTime(anchor.createdAt)} (<Code>{anchor.headHash.slice(0, 16)}…</Code>)</> : 'No anchor published yet.'}</Text>
          <Group gap="xs">
            <Button loading={verify.isPending && verify.variables === false} disabled={verify.isPending} onClick={() => verify.mutate(false)}>Verify new events</Button>
            <Button variant="default" loading={verify.isPending && verify.variables === true} disabled={verify.isPending} onClick={() => verify.mutate(true)}>Full re-verification</Button>
          </Group>
          <Text size="xs" c="dimmed">"Verify new events" checks events added since the last clean run. A full run re-checks every event and detects changes to older history.</Text>
        </Stack>
      )}
    </SectionCard>
  );
}

function AuditSearch() {
  const user = useSignedInUser();
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  // The query only runs after "Search" is pressed (submitted is null until then).
  const [submitted, setSubmitted] = useState<AuditFilters | null>(null);
  const [selected, setSelected] = useState<AuditSearchEvent | null>(null);

  const results = useInfiniteQuery({
    queryKey: queryKeys.auditSearch(submitted ?? {}),
    queryFn: ({ pageParam }) => searchAudit(user, { ...submitted, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    // Older results are fetched "before" the lowest sequence number seen so far.
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: submitted !== null,
    staleTime: 0
  });
  const events = results.data?.pages.flatMap((page) => page.events) ?? [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // datetime-local values are local time; the API wants ISO timestamps.
    setSubmitted({ ...draft, from: draft.from ? new Date(draft.from).toISOString() : undefined, to: draft.to ? new Date(draft.to).toISOString() : undefined });
  };
  // Read the value immediately: React clears `currentTarget` once the handler returns, and the updater may run later.
  const set = (field: keyof typeof EMPTY_FILTERS) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setDraft((d) => ({ ...d, [field]: value }));
  };

  return (
    <SectionCard title="Search audit events" description="Events about tickets in your entity, country and queues, including restricted tickets.">
      <form onSubmit={submit}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Actor" value={draft.actor} onChange={set('actor')} placeholder="User or system ID" />
          <TextInput label="Action starts with" value={draft.action} onChange={set('action')} placeholder="ticket.status" />
          <NativeSelect label="Outcome" value={draft.outcome} onChange={set('outcome')} data={[{ value: '', label: 'Any' }, { value: 'success', label: 'Success' }, { value: 'denied', label: 'Denied' }]} />
          <TextInput type="datetime-local" label="From" value={draft.from} onChange={set('from')} />
          <TextInput type="datetime-local" label="To" value={draft.to} onChange={set('to')} />
          <Group align="flex-end"><Button type="submit" leftSection={<IconSearch size={16} />} loading={results.isFetching && !results.isFetchingNextPage}>Search</Button></Group>
        </SimpleGrid>
      </form>

      {submitted === null ? <Text size="sm" c="dimmed">Set filters and press Search. Leave everything empty for the most recent events.</Text>
        : results.isError ? <ErrorBlock error={results.error} />
        : results.isPending ? <LoadingBlock rows={5} />
        : events.length === 0 ? <EmptyState title="No matching events" />
        : (
          <>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Time</Table.Th><Table.Th>Actor</Table.Th><Table.Th>Action</Table.Th><Table.Th>Target</Table.Th><Table.Th>Outcome</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {events.map((e) => (
                    <Table.Tr key={e.id} className="queue-row" onClick={() => setSelected(e)}>
                      <Table.Td><Text size="sm">{formatDateTime(e.occurredAt)}</Text></Table.Td>
                      <Table.Td><PersonName id={e.actorId} lineClamp={1} /></Table.Td>
                      <Table.Td><Button variant="subtle" size="compact-sm" ff="monospace" onClick={(ev) => { ev.stopPropagation(); setSelected(e); }}>{e.action}</Button></Table.Td>
                      <Table.Td><Text size="sm">{e.targetType} <Code>{e.targetId.slice(0, 8)}</Code></Text></Table.Td>
                      <Table.Td><Badge size="sm" variant="light" color={e.outcome === 'denied' ? 'red' : 'green'}>{e.outcome}</Badge></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {results.hasNextPage && <Group justify="center"><Button variant="default" loading={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>Load older events</Button></Group>}
          </>
        )}

      {/* Full detail of one event, including its metadata and hash. */}
      <Drawer opened={selected !== null} onClose={() => setSelected(null)} position="right" size="md" title={<Title order={2} size="h4">Audit event</Title>}>
        {selected && (
          <Stack gap="sm">
            <Text size="sm"><strong>Action:</strong> <Code>{selected.action}</Code></Text>
            <Text size="sm"><strong>Outcome:</strong> {selected.outcome}</Text>
            {/* Name for readability, plus the exact ID: the ID is what the evidence records. */}
            <Text size="sm"><strong>Actor:</strong> <PersonName id={selected.actorId} /> <Code>{selected.actorId}</Code></Text>
            <Text size="sm"><strong>When:</strong> {formatDateTime(selected.occurredAt)}</Text>
            <Text size="sm"><strong>Target:</strong> {selected.targetType} <Code>{selected.targetId}</Code></Text>
            <Text size="sm"><strong>Sequence:</strong> {selected.sequence}</Text>
            <Text size="sm" fw={600} mt="sm">Metadata</Text>
            <ScrollArea.Autosize mah={300}><Code block>{JSON.stringify(selected.metadata, null, 2)}</Code></ScrollArea.Autosize>
            <Text size="sm" fw={600}>Event hash</Text>
            <Code block style={{ wordBreak: 'break-all' }}>{selected.eventHash}</Code>
          </Stack>
        )}
      </Drawer>
    </SectionCard>
  );
}
