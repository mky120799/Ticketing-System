/**
 * The queue table, built with TanStack Table.
 *
 * TanStack Table is "headless": it does the logic (columns, sorting) and we draw the HTML with Mantine.
 * Sorting happens in the browser over the tickets already loaded; the server always returns newest first.
 */
import { useMemo, useState } from 'react';
import { Anchor, Group, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconArrowsSort, IconMessageReport, IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { Link, useNavigate } from 'react-router-dom';
import { PriorityBadge, SensitivityBadge, SlaBadge, StatusBadge } from '../../components/badges';
import { PersonName } from '../../components/person-name';
import { caseReference, formatDateTime, formatRelative, humanize } from '../../lib/format';
import { isOverdue, PRIORITY_RANK } from '../../lib/labels';
import type { QueueTicket } from './ticket-cache';

/** The SLA date that matters next: first response until it happened or was missed, then resolution. */
const nextDue = (t: QueueTicket) => (t.slaStatus === 'first_response_overdue' || !t.firstResponseDueAt ? t.resolutionDueAt : t.firstResponseDueAt) ?? null;

const columns: ColumnDef<QueueTicket>[] = [
  {
    id: 'subject', header: 'Ticket', accessorKey: 'subject',
    cell: ({ row: { original: t } }) => (
      <Stack gap={2}>
        <Group gap={6} wrap="nowrap">
          {/* A real link, so keyboard and screen-reader users can open the ticket too (and middle-click opens a tab). */}
          <Anchor component={Link} to={`/tickets/${t.id}`} fw={600} size="sm" lineClamp={1} onClick={(event) => event.stopPropagation()}>{t.subject}</Anchor>
          {t.is_complaint && <Tooltip label="Complaint (regulatory clock running)"><IconMessageReport size={16} color="var(--mantine-color-orange-text)" aria-label="Complaint" /></Tooltip>}
          {t.vulnerability_flag && <Tooltip label="Vulnerable customer"><IconAlertTriangle size={16} color="var(--mantine-color-red-text)" aria-label="Vulnerable customer" /></Tooltip>}
          <SensitivityBadge sensitivity={t.sensitivity} size="xs" />
        </Group>
        <Text size="xs" c="dimmed">{caseReference(t.id)} · {humanize(t.category)}</Text>
      </Stack>
    )
  },
  { id: 'status', header: 'Status', accessorKey: 'status', cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
  {
    id: 'priority', header: 'Priority', accessorFn: (t) => PRIORITY_RANK[t.priority] ?? -1,
    cell: ({ row }) => <PriorityBadge priority={row.original.priority} />
  },
  {
    id: 'sla', header: 'Next due', accessorFn: (t) => nextDue(t) ?? '',
    // Search results do not include SLA fields; show a dash rather than a misleading "On track".
    cell: ({ row: { original: t } }) => t.slaStatus === undefined ? <Text size="sm" c="dimmed">—</Text> : (
      <Stack gap={2}>
        <SlaBadge status={t.slaStatus} size="xs" />
        {nextDue(t) && <Tooltip label={formatDateTime(nextDue(t))}><Text size="xs" c={isOverdue(t.slaStatus) ? 'red' : 'dimmed'}>{formatRelative(nextDue(t))}</Text></Tooltip>}
      </Stack>
    )
  },
  { id: 'queue', header: 'Queue', accessorKey: 'queue', cell: ({ getValue }) => <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{humanize(getValue<string>())}</Text> },
  {
    id: 'assignee', header: 'Assignee', accessorFn: (t) => t.assigned_to ?? '',
    // The ticket stores the assignee's ID; PersonName shows their name (search results carry no assignee: "—").
    cell: ({ row: { original: t } }) => t.assigned_to ? <PersonName id={t.assigned_to} maw={180} truncate display="block" /> : <Text size="sm" c="dimmed">{t.assigned_to === undefined ? '—' : 'Unassigned'}</Text>
  },
  {
    id: 'createdAt', header: 'Created', accessorKey: 'createdAt',
    cell: ({ getValue }) => <Tooltip label={formatDateTime(getValue<string>())}><Text size="sm">{formatRelative(getValue<string>())}</Text></Tooltip>
  }
];

export function TicketTable({ tickets }: { tickets: QueueTicket[] }) {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const data = useMemo(() => tickets, [tickets]);
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (t) => t.id });

  return (
    <Table.ScrollContainer minWidth={920}>
      <Table verticalSpacing="sm" highlightOnHover={false} stickyHeader>
        <Table.Thead>
          {table.getHeaderGroups().map((group) => (
            <Table.Tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const SortIcon = sorted === 'asc' ? IconSortAscending : sorted === 'desc' ? IconSortDescending : IconArrowsSort;
                return (
                  // aria-sort tells screen readers which column the table is sorted by.
                  <Table.Th key={header.id} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                    <UnstyledButton onClick={header.column.getToggleSortingHandler()} aria-label={`Sort by ${String(header.column.columnDef.header)}`}>
                      <Group gap={4} wrap="nowrap">
                        <Text size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>{flexRender(header.column.columnDef.header, header.getContext())}</Text>
                        <SortIcon size={14} color={sorted ? undefined : 'var(--mantine-color-dimmed)'} />
                      </Group>
                    </UnstyledButton>
                  </Table.Th>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        <Table.Tbody>
          {table.getRowModel().rows.map((row) => (
            // The whole row opens the ticket for mouse users; the subject link does the same for keyboard users.
            <Table.Tr key={row.id} className="queue-row" onClick={() => navigate(`/tickets/${row.original.id}`)}>
              {row.getVisibleCells().map((cell) => <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>)}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
