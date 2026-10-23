/**
 * Complaint handling and other regulatory controls.
 *
 *   - Marking a complaint starts a regulatory clock (e.g. Australian RG 271: acknowledge within 1 business day,
 *     final response within 30 days), counted from when the ticket was RECEIVED, not when it was marked.
 *   - Flags: vulnerable customer, systemic issue (both feed the dashboard and the complaints register).
 *   - Supervisors: record a referral to the external dispute scheme (AFCA in Australia), and block customer
 *     communications when contacting the customer could tip off a suspect (fraud, investigations).
 */
import { useState } from 'react';
import { Alert, Button, Group, NativeSelect, Paper, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { classifyComplaint, getRegulatoryProfiles, setCommunicationBlock, updateAfca, type Ticket } from '../../../api';
import { RegulatoryBadge } from '../../../components/badges';
import { formatDateTime, humanize } from '../../../lib/format';
import { queryKeys } from '../../../lib/query-keys';
import { useSession, useSignedInUser } from '../../../session/session-provider';
import { useTicketMutation } from '../../tickets/use-ticket-queries';

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <Stack gap={2}><Text size="xs" c="dimmed" fw={500}>{label}</Text><Text size="sm" component="div">{children}</Text></Stack>
);

export function ComplianceTab({ ticket }: { ticket: Ticket }) {
  const user = useSignedInUser();
  const { can } = useSession();
  const [profileKey, setProfileKey] = useState('');
  const [afcaRef, setAfcaRef] = useState('');
  const privacy = ticket.case_kind === 'privacy_request';

  // The profile list is only needed to mark a complaint, so it loads only when that form is on screen.
  const profiles = useQuery({ queryKey: queryKeys.config('regulatory-profiles'), queryFn: () => getRegulatoryProfiles(user), enabled: !ticket.regulatory_profile && can('workTicket'), retry: false });
  const activeProfiles = profiles.data?.filter((p) => p.active) ?? [];
  const chosenProfile = profileKey || activeProfiles[0]?.profileKey || '';

  const classify = useTicketMutation(ticket.id, (u, body: Parameters<typeof classifyComplaint>[2]) => classifyComplaint(u, ticket.id, body), 'Compliance details updated');
  const afca = useTicketMutation(ticket.id, (u) => updateAfca(u, ticket.id, 'referred', afcaRef.trim() || undefined), 'External dispute referral recorded');
  const block = useTicketMutation(ticket.id, (u) => setCommunicationBlock(u, ticket.id, !ticket.communications_blocked, ticket.communications_blocked ? 'Block lifted by supervisor' : 'Blocked by supervisor'),
    ticket.communications_blocked ? 'Customer communications allowed again' : 'Customer communications blocked');

  /** Flags are sent with the existing profile so the clock is left untouched. */
  const toggleFlag = (flag: 'vulnerabilityFlag' | 'systemicIssue', on: boolean, reason: string) =>
    classify.mutate({ isComplaint: true, profileKey: ticket.regulatory_profile ?? undefined, [flag]: on, reason });

  return (
    <Stack gap="lg">
      <Paper p="lg">
        <Title order={3} size="h5" mb="md">{privacy ? 'Privacy request' : 'Complaint'}</Title>
        {ticket.regulatory_profile ? (
          <Stack gap="md">
            <Group gap="xs"><RegulatoryBadge status={ticket.regulatory_status} size="md" /><Text size="sm" c="dimmed">{ticket.regulatory_profile}</Text></Group>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Fact label="Acknowledge by">{formatDateTime(ticket.acknowledge_due_at)}</Fact>
              <Fact label="Final response by">{formatDateTime(ticket.final_response_due_at)}</Fact>
              <Fact label="Outcome">{ticket.idr_outcome ? humanize(ticket.idr_outcome) : 'Not resolved yet'}</Fact>
            </SimpleGrid>
            {can('workTicket') && (
              <Group gap="xs">
                <Button size="xs" variant={ticket.vulnerability_flag ? 'filled' : 'default'} color={ticket.vulnerability_flag ? 'red' : undefined} loading={classify.isPending}
                  onClick={() => toggleFlag('vulnerabilityFlag', !ticket.vulnerability_flag, 'Vulnerability flag changed')}>{ticket.vulnerability_flag ? 'Clear vulnerable flag' : 'Flag vulnerable customer'}</Button>
                <Button size="xs" variant={ticket.systemic_issue ? 'filled' : 'default'} color={ticket.systemic_issue ? 'orange' : undefined} loading={classify.isPending}
                  onClick={() => toggleFlag('systemicIssue', !ticket.systemic_issue, 'Systemic issue flag changed')}>{ticket.systemic_issue ? 'Clear systemic flag' : 'Flag systemic issue'}</Button>
              </Group>
            )}
          </Stack>
        ) : (
          <Stack gap="sm">
            <Text size="sm">Not classified as a complaint. If the customer expressed dissatisfaction, mark it: the regulatory clock starts from when the ticket was received.</Text>
            {can('workTicket') && (
              <Group align="flex-end" gap="sm">
                {/* Pick from the configured profiles; if none are visible in this jurisdiction, type the profile key. */}
                {activeProfiles.length
                  ? <NativeSelect label="Regulatory profile" value={chosenProfile} onChange={(e) => setProfileKey(e.currentTarget.value)} data={activeProfiles.map((p) => ({ value: p.profileKey, label: p.label }))} style={{ flex: 1 }} />
                  : <TextInput label="Regulatory profile key" description="No profiles are listed for your jurisdiction; enter the key your administrator gave you." value={profileKey} onChange={(e) => setProfileKey(e.currentTarget.value)} placeholder="au-rg271-standard" style={{ flex: 1 }} />}
                <Button disabled={!chosenProfile} loading={classify.isPending} onClick={() => classify.mutate({ isComplaint: true, profileKey: chosenProfile, reason: 'Customer expressed dissatisfaction' })}>Mark as complaint</Button>
              </Group>
            )}
          </Stack>
        )}
      </Paper>

      {can('supervise') && (
        <Paper p="lg">
          <Title order={3} size="h5" mb="md">Supervisor controls</Title>
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="sm" fw={600}>External dispute scheme</Text>
              <Text size="sm" c="dimmed">Status: {humanize(ticket.afca_status ?? 'none')}{ticket.afca_reference ? ` (reference ${ticket.afca_reference})` : ''}</Text>
              <Group align="flex-end" gap="sm">
                <TextInput label="Scheme reference" value={afcaRef} onChange={(e) => setAfcaRef(e.currentTarget.value)} placeholder="Optional" />
                <Button variant="default" loading={afca.isPending} onClick={() => afca.mutate(undefined)}>Record referral</Button>
              </Group>
            </Stack>
            <Stack gap="xs">
              <Text size="sm" fw={600}>Customer communications</Text>
              {ticket.communications_blocked && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />} p="xs">Blocked: no messages or customer replies can be sent on this case.</Alert>}
              <Group><Button variant={ticket.communications_blocked ? 'default' : 'light'} color={ticket.communications_blocked ? undefined : 'red'} loading={block.isPending} onClick={() => block.mutate(undefined)}>
                {ticket.communications_blocked ? 'Lift block' : 'Block customer communications'}
              </Button></Group>
              <Text size="xs" c="dimmed">The reason is kept in the audit trail only, never in integration events.</Text>
            </Stack>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
