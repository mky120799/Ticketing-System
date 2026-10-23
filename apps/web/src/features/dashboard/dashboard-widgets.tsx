/**
 * Building blocks for the dashboard: headline number tiles and simple bar/line charts.
 *
 * Chart rules followed (from our data-visualisation guidelines):
 *   - Series colours come from a validated, colour-blind-safe palette, in fixed order (blue, then orange).
 *   - Single-series bars have no legend (the card title names the measure) and print each value beside its bar.
 *   - Two-series charts always have a legend, so identity never depends on colour alone.
 *   - Every chart has a table alternative for screen readers and exact figures.
 */
import { useState, type ReactNode } from 'react';
import { LineChart } from '@mantine/charts';
import { Group, Paper, SegmentedControl, Stack, Table, Text, ThemeIcon } from '@mantine/core';

/** Categorical palette slots 1 and 2 (validated: CVD ΔE 24.7, contrast ≥ 3:1 on white). */
export const SERIES = { first: '#2a78d6', second: '#eb6834' } as const;

/** A headline number with its label. `tone="alert"` turns the number red, used only when something needs action. */
export function StatTile({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: string; tone?: 'alert'; icon?: ReactNode }) {
  return (
    <Paper p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>{label}</Text>
          <Text fz={28} fw={700} lh={1.1} c={tone === 'alert' ? 'red' : undefined}>{value}</Text>
          {hint && <Text size="xs" c="dimmed">{hint}</Text>}
        </Stack>
        {icon && <ThemeIcon variant="light" color={tone === 'alert' ? 'red' : 'bank'} size="lg" radius="md" aria-hidden>{icon}</ThemeIcon>}
      </Group>
    </Paper>
  );
}

/** Lets a chart be swapped for its underlying table (exact numbers, and easier for screen readers). */
export function ChartOrTable({ chart, table, label }: { chart: ReactNode; table: ReactNode; label: string }) {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  return (
    <Stack gap="sm">
      <SegmentedControl size="xs" w="fit-content" value={mode} onChange={(v) => setMode(v as 'chart' | 'table')} aria-label={`${label}: show as`}
        data={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
      {mode === 'chart' ? <figure aria-label={label} style={{ margin: 0 }}>{chart}</figure> : table}
    </Stack>
  );
}

/**
 * Horizontal bars for one measure across categories (root causes, channels, ageing buckets).
 * Drawn as plain HTML rows (label · bar · number) rather than an SVG chart: every value is printed next to its bar,
 * so nothing depends on hovering, small values stay readable, and screen readers read it as a simple list.
 */
export function SingleBars({ rows, label, empty }: { rows: { name: string; value: number }[]; label: string; empty: string }) {
  if (!rows.length) return <Text size="sm" c="dimmed">{empty}</Text>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Stack gap={10} component="ul" aria-label={label} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((r) => (
        <li key={r.name} className="bar-row">
          <Text size="sm" truncate title={r.name}>{r.name}</Text>
          <div className="bar-track" aria-hidden>
            {/* A non-zero value always gets at least a sliver of bar, so "small" never looks like "none". */}
            <div className="bar-fill" style={{ width: r.value ? `max(4px, ${(r.value / max) * 100}%)` : 0, background: SERIES.first }} />
          </div>
          <Text size="sm" fw={600} ta="right">{r.value.toLocaleString()}</Text>
        </li>
      ))}
    </Stack>
  );
}

/** Created vs resolved per week: are we keeping up with incoming work? */
export function CreatedResolvedChart({ series }: { series: { week: string; created: number; resolved: number; complaints: number; escalated: number }[] }) {
  return (
    <ChartOrTable label="Tickets created and resolved per week"
      chart={
        <LineChart h={260} data={series} dataKey="week" withLegend legendProps={{ verticalAlign: 'top', height: 36 }} strokeWidth={2} curveType="linear"
          dotProps={{ r: 4 }} activeDotProps={{ r: 5 }} gridAxis="y" yAxisProps={{ allowDecimals: false }}
          series={[{ name: 'created', label: 'Created', color: SERIES.first }, { name: 'resolved', label: 'Resolved', color: SERIES.second }]} />
      }
      table={<SimpleTable head={['Week starting', 'Created', 'Resolved', 'Complaints', 'Escalated']} rows={series.map((r) => [r.week, r.created, r.resolved, r.complaints, r.escalated])} />}
    />
  );
}

/** A plain table: used for chart alternatives and the breakdown lists. Numbers are right-aligned so they line up. */
export function SimpleTable({ head, rows, highlight }: { head: string[]; rows: (string | number)[][]; highlight?: (row: (string | number)[], column: number) => boolean }) {
  return (
    <Table.ScrollContainer minWidth={320}>
      <Table striped verticalSpacing={6}>
        <Table.Thead><Table.Tr>{head.map((h, i) => <Table.Th key={h || i} ta={i === 0 ? 'left' : 'right'}>{h}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={String(row[0])}>
              {row.map((cell, i) => <Table.Td key={i} ta={i === 0 ? 'left' : 'right'} c={highlight?.(row, i) ? 'red' : undefined} fw={highlight?.(row, i) ? 700 : undefined}>{cell}</Table.Td>)}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
