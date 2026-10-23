/**
 * Supervisor and auditor dashboard. Aggregates only (counts and percentages across the person's queues):
 * the API never sends ticket content to this screen.
 *
 * Reading order, top to bottom: "how are we doing right now" → complaints (regulatory risk) → trends over time
 * → where the work and the problems are (root causes, channels, queues, ageing).
 */
import { useState } from 'react';
import '@mantine/charts/styles.css';
import { Button, Grid, NativeSelect, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconClockHour4, IconDownload, IconRefresh, IconTicket } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { downloadComplaintsRegister, getDashboard, getTrends } from '../../api';
import { PageHeader } from '../../components/page-header';
import { SectionCard } from '../../components/section-card';
import { ErrorBlock, LoadingBlock } from '../../components/states';
import { humanize } from '../../lib/format';
import { queryKeys } from '../../lib/query-keys';
import { useSignedInUser } from '../../session/session-provider';
import { CreatedResolvedChart, SimpleTable, SingleBars, StatTile } from './dashboard-widgets';

const AGING_LABELS: Record<string, string> = { under_1_day: 'Under 1 day', '1_to_3_days': '1–3 days', '3_to_7_days': '3–7 days', over_7_days: 'Over 7 days' };
const percent = (value: number | null) => (value === null ? '—' : `${value}%`);

export default function DashboardPage() {
  const user = useSignedInUser();
  const [weeks, setWeeks] = useState(12);
  const summary = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => getDashboard(user) });
  const trends = useQuery({ queryKey: queryKeys.trends(weeks), queryFn: () => getTrends(user, weeks) });
  const exportRegister = useMutation({
    mutationFn: () => {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      return downloadComplaintsRegister(user, from, to);
    }
  });

  if (summary.isPending) return <><PageHeader title="Dashboard" /><LoadingBlock rows={8} height={60} /></>;
  if (summary.isError) return <><PageHeader title="Dashboard" /><ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /></>;

  const d = summary.data;
  // Share of active tickets that have not missed a target.
  const onTime = d.totals.active ? Math.round(((d.totals.active - d.totals.overdue) / d.totals.active) * 100) : 100;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Dashboard"
        description={`Counts across your queues, as of ${new Date(d.asOf).toLocaleTimeString()}. Never ticket content.`}
        actions={<>
          <Button variant="default" leftSection={<IconRefresh size={16} />} loading={summary.isFetching} onClick={() => { void summary.refetch(); void trends.refetch(); }}>Refresh</Button>
          <Button variant="light" leftSection={<IconDownload size={16} />} loading={exportRegister.isPending} onClick={() => exportRegister.mutate()}>Complaints register (CSV)</Button>
        </>}
      />

      {/* Right now */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
        <StatTile label="Active" value={d.totals.active} icon={<IconTicket size={20} />} />
        <StatTile label="Overdue" value={d.totals.overdue} tone={d.totals.overdue ? 'alert' : undefined} icon={<IconAlertTriangle size={20} />} hint="Missed a service level" />
        <StatTile label="On time" value={`${onTime}%`} icon={<IconClockHour4 size={20} />} hint="Active tickets within target" />
        <StatTile label="Resolved" value={d.totals.resolved} icon={<IconCircleCheck size={20} />} />
        <StatTile label="Closed" value={d.totals.closed} />
      </SimpleGrid>

      {/* Regulatory risk */}
      <SectionCard title="Complaints and privacy requests" description="Regulatory clocks: acknowledgement and final-response deadlines.">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <StatTile label="Open complaints" value={d.complaints.open} />
          <StatTile label="Acknowledgement overdue" value={d.complaints.ackOverdue} tone={d.complaints.ackOverdue ? 'alert' : undefined} />
          <StatTile label="At risk" value={d.complaints.atRisk} />
          <StatTile label="Final response overdue" value={d.complaints.finalResponseOverdue} tone={d.complaints.finalResponseOverdue ? 'alert' : undefined} />
          <StatTile label="Vulnerable customers" value={d.complaints.vulnerable} />
          <StatTile label="With external scheme" value={d.complaints.withExternalDisputeScheme} />
          <StatTile label="Privacy requests open" value={d.privacyRequests.open} />
          <StatTile label="Privacy requests overdue" value={d.privacyRequests.overdue} tone={d.privacyRequests.overdue ? 'alert' : undefined} />
        </SimpleGrid>
      </SectionCard>

      {/* Over time */}
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <SectionCard title="Trends" description="Are we keeping up with incoming work?"
            actions={<NativeSelect aria-label="Number of weeks" size="xs" value={String(weeks)} onChange={(e) => setWeeks(Number(e.currentTarget.value))} data={[4, 8, 12, 26, 52].map((n) => ({ value: String(n), label: `Last ${n} weeks` }))} />}>
            {trends.isPending ? <LoadingBlock rows={6} /> : trends.isError ? <ErrorBlock error={trends.error} onRetry={() => void trends.refetch()} /> : <CreatedResolvedChart series={trends.data.series} />}
          </SectionCard>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <SectionCard title="Last 30 days">
            <SimpleGrid cols={2}>
              <StatTile label="Resolved" value={d.last30Days.resolved} />
              <StatTile label="Escalations" value={d.last30Days.escalations} />
              <StatTile label="Resolved on time" value={percent(d.last30Days.resolvedOnTimePercent)} />
              <StatTile label="First response on time" value={percent(d.last30Days.firstResponseOnTimePercent)} />
            </SimpleGrid>
            <Text size="sm" c="dimmed">Average first response: {d.last30Days.avgFirstResponseMinutes === null ? '—' : `${d.last30Days.avgFirstResponseMinutes} minutes`}</Text>
          </SectionCard>
        </Grid.Col>
      </Grid>

      {/* Where the problems are */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <SectionCard title="Root causes" description="Resolved tickets, last 30 days.">
          <SingleBars label="Root causes of resolved tickets" rows={d.last30Days.rootCauses.map((r) => ({ name: humanize(r.cause), value: r.count }))} empty="No resolved tickets yet." />
        </SectionCard>
        <SectionCard title="Source channels" description="Where tickets came from, last 30 days.">
          <SingleBars label="Tickets by source channel" rows={d.last30Days.channels.map((c) => ({ name: humanize(c.channel), value: c.count }))} empty="No tickets yet." />
        </SectionCard>
        <SectionCard title="Workload by queue">
          <SimpleTable head={['Queue', 'Active', 'Overdue', 'Total']} rows={d.queues.map((q) => [humanize(q.queue), q.active, q.overdue, q.total])} highlight={(row, column) => column === 2 && Number(row[2]) > 0} />
        </SectionCard>
        <SectionCard title="Ageing of open tickets" description="How long open tickets have been waiting.">
          <SingleBars label="Open tickets by age" rows={d.aging.map((a) => ({ name: AGING_LABELS[a.bucket] ?? a.bucket, value: a.count }))} empty="No open tickets." />
        </SectionCard>
      </SimpleGrid>

      {trends.data && (
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
          <SectionCard title="By category" description={`Last ${weeks} weeks.`}>
            <SimpleTable head={['Category', 'Created', 'Resolved']} rows={trends.data.byCategory.map((r) => [humanize(r.key), r.created, r.resolved])} />
          </SectionCard>
          <SectionCard title="By branch" description={`Last ${weeks} weeks.`}>
            <SimpleTable head={['Branch', 'Created', 'Resolved']} rows={trends.data.byBranch.map((r) => [r.key, r.created, r.resolved])} />
          </SectionCard>
        </SimpleGrid>
      )}
    </Stack>
  );
}
