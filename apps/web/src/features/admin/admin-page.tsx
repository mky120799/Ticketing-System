/**
 * Administration: the bank's configuration, split into areas with their own URL (/admin/routing, /admin/templates...).
 * The old console put all fourteen forms on one page. Administrators have no access to ticket content by design.
 */
import { ScrollArea, Tabs } from '@mantine/core';
import { IconArrowsSplit, IconCalendarTime, IconGitBranch, IconInbox, IconPlugConnected, IconScale, IconTemplate } from '@tabler/icons-react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/page-header';
import { ComplianceSection } from './sections/compliance-section';
import { IntakeSection } from './sections/intake-section';
import { IntegrationSection } from './sections/integration-section';
import { RoutingSection } from './sections/routing-section';
import { ServiceLevelsSection } from './sections/service-levels-section';
import { TemplatesSection } from './sections/templates-section';
import { WorkflowsSection } from './sections/workflows-section';

const SECTIONS = [
  { key: 'routing', label: 'Routing', icon: IconArrowsSplit, render: () => <RoutingSection /> },
  { key: 'intake', label: 'Intake channels', icon: IconInbox, render: () => <IntakeSection /> },
  { key: 'service-levels', label: 'Service levels', icon: IconCalendarTime, render: () => <ServiceLevelsSection /> },
  { key: 'compliance', label: 'Compliance', icon: IconScale, render: () => <ComplianceSection /> },
  { key: 'workflows', label: 'Workflows', icon: IconGitBranch, render: () => <WorkflowsSection /> },
  { key: 'templates', label: 'Message templates', icon: IconTemplate, render: () => <TemplatesSection /> },
  { key: 'integration', label: 'Integration events', icon: IconPlugConnected, render: () => <IntegrationSection /> }
];

export default function AdminPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const current = SECTIONS.find((s) => s.key === section);
  if (!current) return <Navigate to="/admin/routing" replace />;

  return (
    <>
      <PageHeader title="Administration" description="How work is routed, timed and communicated. Changes take effect immediately and are audited." />
      <Tabs value={current.key} onChange={(key) => key && navigate(`/admin/${key}`)} keepMounted={false}>
        <ScrollArea type="never" mb="lg">
          <Tabs.List style={{ flexWrap: 'nowrap' }}>
            {SECTIONS.map((s) => <Tabs.Tab key={s.key} value={s.key} leftSection={<s.icon size={16} />}>{s.label}</Tabs.Tab>)}
          </Tabs.List>
        </ScrollArea>
        {SECTIONS.map((s) => <Tabs.Panel key={s.key} value={s.key}>{s.render()}</Tabs.Panel>)}
      </Tabs>
    </>
  );
}
