/**
 * The case screen: one ticket, full width, at its own URL (/tickets/:ticketId).
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ ← Tickets   Subject (h1)   [badges]      [Assign] [Change status] │
 *   ├──────────────────────────────────────────┬────────────────────┤
 *   │ Description                              │ Details            │
 *   │ Tabs: Activity | Communications | ...    │ Service levels     │
 *   │                                          │ Customer references│
 *   └──────────────────────────────────────────┴────────────────────┘
 *
 * The old console stacked nine panels in one long column. Here the summary is always visible on the right, and
 * the detail is split into tabs. The open tab is kept in the URL (?tab=attachments) so it survives a refresh.
 */
import { Badge, Grid, ScrollArea, Stack, Tabs } from '@mantine/core';
import { IconFileText, IconHistory, IconLink, IconLock, IconMail, IconPaperclip, IconScale, IconShieldCheck } from '@tabler/icons-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../components/states';
import { useSession } from '../../session/session-provider';
import { useTicket } from '../tickets/use-ticket-queries';
import { CaseSidebar } from './case-sidebar';
import { DescriptionCard } from './description-card';
import { TicketHeader } from './ticket-header';
import { ActivityTab } from './tabs/activity-tab';
import { AttachmentsTab } from './tabs/attachments-tab';
import { AuditTab } from './tabs/audit-tab';
import { CommunicationsTab } from './tabs/communications-tab';
import { ComplianceTab } from './tabs/compliance-tab';
import { RelatedTab } from './tabs/related-tab';
import { RetentionTab } from './tabs/retention-tab';

/** Small count next to a tab name, e.g. "Attachments 3". Hidden when zero. */
const Count = ({ n }: { n: number | undefined }) => (n ? <Badge size="xs" variant="light" color="gray" circle>{n}</Badge> : null);

export function TicketPage() {
  const { ticketId = '' } = useParams();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const ticket = useTicket(ticketId);
  const tab = params.get('tab') ?? 'activity';

  if (ticket.isPending) return <LoadingBlock rows={10} height={24} />;
  if (ticket.isError) {
    // 403 and 404 look the same on purpose: telling someone "this exists but you can't see it" leaks information.
    const hidden = ticket.error instanceof ApiError && (ticket.error.status === 403 || ticket.error.status === 404);
    return hidden
      ? <EmptyState icon={<IconLock size={24} />} title="This ticket is not available" description="It may not exist, or it is outside your queues, branch or sensitivity level. Access is decided by the bank's policy and every attempt is audited." />
      : <ErrorBlock error={ticket.error} onRetry={() => void ticket.refetch()} title="The ticket could not be loaded" />;
  }

  const t = ticket.data;
  const complianceAlert = t.regulatory_status === 'ack_overdue' || t.regulatory_status === 'final_response_overdue' || t.regulatory_status === 'at_risk';

  return (
    <Stack gap="lg">
      <TicketHeader ticket={t} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="lg">
            <DescriptionCard ticket={t} />
            {/* keepMounted={false}: a tab's content (and its API calls) only exists while the tab is open. */}
            <Tabs value={tab} onChange={(value) => setParams(value && value !== 'activity' ? { tab: value } : {}, { replace: true })} keepMounted={false} variant="outline">
              {/* One row of tabs that scrolls sideways on narrow screens, instead of wrapping onto a second line. */}
              <ScrollArea type="never">
              <Tabs.List style={{ flexWrap: 'nowrap' }}>
                <Tabs.Tab value="activity" leftSection={<IconFileText size={16} />}>Activity</Tabs.Tab>
                <Tabs.Tab value="communications" leftSection={<IconMail size={16} />} rightSection={<Count n={t.communications?.length} />}>Communications</Tabs.Tab>
                <Tabs.Tab value="attachments" leftSection={<IconPaperclip size={16} />} rightSection={<Count n={t.attachments?.length} />}>Attachments</Tabs.Tab>
                <Tabs.Tab value="related" leftSection={<IconLink size={16} />} rightSection={<Count n={t.relatedTickets?.length} />}>Related</Tabs.Tab>
                <Tabs.Tab value="compliance" leftSection={<IconScale size={16} />} color={complianceAlert ? 'red' : undefined}>Compliance</Tabs.Tab>
                {can('supervise') && <Tabs.Tab value="retention" leftSection={<IconHistory size={16} />}>Retention</Tabs.Tab>}
                {can('viewAudit') && <Tabs.Tab value="audit" leftSection={<IconShieldCheck size={16} />}>Audit trail</Tabs.Tab>}
              </Tabs.List>
              </ScrollArea>
              <Tabs.Panel value="activity" pt="md"><ActivityTab ticket={t} /></Tabs.Panel>
              <Tabs.Panel value="communications" pt="md"><CommunicationsTab ticket={t} /></Tabs.Panel>
              <Tabs.Panel value="attachments" pt="md"><AttachmentsTab ticket={t} /></Tabs.Panel>
              <Tabs.Panel value="related" pt="md"><RelatedTab ticket={t} /></Tabs.Panel>
              <Tabs.Panel value="compliance" pt="md"><ComplianceTab ticket={t} /></Tabs.Panel>
              {can('supervise') && <Tabs.Panel value="retention" pt="md"><RetentionTab ticket={t} /></Tabs.Panel>}
              {can('viewAudit') && <Tabs.Panel value="audit" pt="md"><AuditTab ticketId={t.id} /></Tabs.Panel>}
            </Tabs>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <CaseSidebar ticket={t} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
