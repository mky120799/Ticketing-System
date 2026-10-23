/**
 * The ticket queue: a case worker's main screen.
 *
 * Layout: page title + "New ticket" → a toolbar (search, views, filters) → the table → "Load more".
 *
 * View, filters and search live in the URL (?view=mine&priority=high&q=card). That means the Back button from a
 * ticket returns to exactly the same list, and a filtered list can be bookmarked or shared.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, NativeSelect, Paper, ScrollArea, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconInfoCircle, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../components/states';
import { PRIORITIES } from '../../api';
import { humanize } from '../../lib/format';
import { isOverdue, priorityLook, statusLook } from '../../lib/labels';
import { useSession } from '../../session/session-provider';
import { CreateTicketModal } from './create-ticket-modal';
import type { QueueTicket } from './ticket-cache';
import { TicketTable } from './ticket-table';
import { useTicketList } from './use-ticket-queries';

/** Statuses that mean "nothing left to do". */
const FINISHED = new Set(['resolved', 'closed', 'cancelled']);

/** The quick views across the top. Each is a filter over the loaded tickets. */
const VIEWS: { value: string; label: string; test: (t: QueueTicket, me: string) => boolean }[] = [
  { value: 'open', label: 'Open', test: (t) => !FINISHED.has(t.status) },
  { value: 'mine', label: 'Assigned to me', test: (t, me) => t.assigned_to === me && !FINISHED.has(t.status) },
  { value: 'unassigned', label: 'Unassigned', test: (t) => !t.assigned_to && !FINISHED.has(t.status) },
  { value: 'overdue', label: 'Overdue', test: (t) => isOverdue(t.slaStatus) && !FINISHED.has(t.status) },
  { value: 'complaints', label: 'Complaints', test: (t) => Boolean(t.is_complaint) && !FINISHED.has(t.status) },
  { value: 'all', label: 'All', test: () => true }
];

export function TicketsPage() {
  const { can, profile } = useSession();
  const [params, setParams] = useSearchParams();
  const [createOpened, createModal] = useDisclosure(false);

  // --- state kept in the URL -------------------------------------------------
  const view = params.get('view') ?? 'open';
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const queue = params.get('queue') ?? '';
  const setParam = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  // The search box updates instantly, but the server is only asked once typing pauses for 350 ms (debounce).
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const [search] = useDebouncedValue(searchInput.trim(), 350);
  // Only `search` matters here; setParam uses a functional update, so it never reads stale params.
  useEffect(() => setParam('q', search), [search]);

  // --- data -----------------------------------------------------------------
  const list = useTicketList(search);
  const loaded = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const searching = Boolean(search);

  // Search results carry only basic fields (no assignee or SLA), so views do not apply while searching.
  const activeView = VIEWS.find((v) => v.value === view) ?? VIEWS[0];
  const me = profile?.subject ?? '';
  const rows = useMemo(() => loaded.filter((t) =>
    (searching || activeView.test(t, me)) && (!status || t.status === status) && (!priority || t.priority === priority) && (!queue || t.queue === queue)
  ), [loaded, searching, activeView, me, status, priority, queue]);

  // Filter choices come from what is loaded, so every option shown has at least one ticket.
  const statusOptions = useMemo(() => [...new Set(loaded.map((t) => t.status))].sort(), [loaded]);
  const queueOptions = profile?.queues ?? [];
  const filtersActive = Boolean(status || priority || queue || searchInput);
  const clearFilters = () => { setSearchInput(''); setParams(view === 'open' ? {} : { view }, { replace: true }); };

  return (
    <>
      <PageHeader
        title="Tickets"
        description="Cases in your queues, newest first. Changes made by colleagues appear automatically."
        actions={can('createTicket') && <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>New ticket</Button>}
      />

      <Paper p={0}>
        {/* Toolbar */}
        <Stack gap="sm" p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <Group gap="sm" wrap="wrap" align="flex-end">
            <TextInput
              aria-label="Search tickets" placeholder="Search subject, category, status or queue"
              leftSection={<IconSearch size={16} />} value={searchInput} onChange={(event) => setSearchInput(event.currentTarget.value)}
              style={{ flex: '1 1 280px' }}
            />
            <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.currentTarget.value)}
              data={[{ value: '', label: 'Any status' }, ...statusOptions.map((s) => ({ value: s, label: statusLook(s).label }))]} />
            <NativeSelect aria-label="Filter by priority" value={priority} onChange={(e) => setParam('priority', e.currentTarget.value)}
              data={[{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: priorityLook(p).label }))]} />
            <NativeSelect aria-label="Filter by queue" value={queue} onChange={(e) => setParam('queue', e.currentTarget.value)}
              data={[{ value: '', label: 'Any queue' }, ...queueOptions.map((q) => ({ value: q, label: humanize(q) }))]} />
            {filtersActive && <Button variant="subtle" leftSection={<IconX size={14} />} onClick={clearFilters}>Clear</Button>}
          </Group>
          <ScrollArea type="never">
            <SegmentedControl
              aria-label="Ticket view" value={activeView.value} onChange={(value) => setParam('view', value === 'open' ? '' : value)} disabled={searching}
              data={VIEWS.map((v) => ({ value: v.value, label: `${v.label} (${loaded.filter((t) => v.test(t, me)).length})` }))}
            />
          </ScrollArea>
          {searching && (
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} p="xs">
              Showing search results. Search covers safe metadata only and returns basic fields; clear the search to use views.
            </Alert>
          )}
        </Stack>

        {/* Table, or its loading / error / empty state */}
        {list.isPending ? <Stack p="md"><LoadingBlock rows={8} height={28} /></Stack>
          : list.isError ? <Stack p="md"><ErrorBlock error={list.error} onRetry={() => void list.refetch()} title="Tickets could not be loaded" /></Stack>
          : rows.length === 0 ? <EmptyState title={filtersActive || view !== 'all' ? 'No tickets match' : 'No tickets yet'} description={filtersActive ? 'Try clearing the filters.' : 'New tickets in your queues will appear here.'} />
          : <TicketTable tickets={rows} />}

        {/* Footer: how many, and paging */}
        <Group justify="space-between" p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
          <Text size="sm" c="dimmed" aria-live="polite">Showing {rows.length} of {loaded.length} loaded tickets</Text>
          {list.hasNextPage && <Button variant="default" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>}
        </Group>
      </Paper>

      <CreateTicketModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}
