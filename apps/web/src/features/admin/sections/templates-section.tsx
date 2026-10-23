/**
 * Message templates: the wording of customer messages.
 * Only two placeholders exist, {{ticketRef}} and {{status}}, so a message can never pull in other case data.
 * The editor shows a live preview with sample values.
 */
import { useState } from 'react';
import { Badge, Checkbox, Grid, Paper, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { getMessageTemplates, saveMessageTemplate, type MessageTemplate } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { humanize } from '../../../lib/format';
import { ActiveBadge, EditButton, EditorModal, useConfigList, useConfigSave } from '../admin-kit';

/** Fills the placeholders with sample values for the preview. */
const preview = (text: string | null) => (text ?? '').replace(/\{\{ticketRef\}\}/g, 'CASE-1A2B3C4D').replace(/\{\{status\}\}/g, 'being worked on');

export function TemplatesSection() {
  const templates = useConfigList('communication-templates-all', getMessageTemplates);
  const [draft, setDraft] = useState<MessageTemplate | null>(null);
  const save = useConfigSave(saveMessageTemplate, ['communication-templates-all', 'communication-templates'], (t) => `Template "${t.templateKey}" saved`);

  return (
    <SectionCard title="Message templates" description={<>Wording of customer messages. Only <code>{'{{ticketRef}}'}</code> and <code>{'{{status}}'}</code> can be used, so a message never includes other case data.</>}>
      {templates.isPending ? <LoadingBlock rows={4} /> : !templates.data?.length ? <EmptyState title="No templates" /> : (
        <Table.ScrollContainer minWidth={600}>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Template</Table.Th><Table.Th>Channel</Table.Th><Table.Th>Subject</Table.Th><Table.Th>Approval</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {templates.data.map((t) => (
                <Table.Tr key={t.templateKey}>
                  <Table.Td><Text size="sm" fw={500}>{humanize(t.templateKey)}</Text></Table.Td>
                  <Table.Td>{humanize(t.channel)}</Table.Td>
                  <Table.Td><Text size="sm" lineClamp={1} c={t.subjectTemplate ? undefined : 'dimmed'}>{t.subjectTemplate ?? 'No wording yet'}</Text></Table.Td>
                  <Table.Td>{t.requiresApproval ? <Badge size="sm" variant="light" color="yellow">Required</Badge> : <Text size="sm" c="dimmed">No</Text>}</Table.Td>
                  <Table.Td><ActiveBadge active={t.active} /></Table.Td>
                  <Table.Td ta="right"><EditButton label={`Edit ${t.templateKey}`} onClick={() => setDraft(t)} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {draft && (
        <EditorModal size="xl" title={`Template: ${humanize(draft.templateKey)}`} opened onClose={() => setDraft(null)} saving={save.isPending} onSubmit={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          <Grid gutter="lg">
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Stack gap="sm">
                <TextInput label="Subject" required maxLength={200} value={draft.subjectTemplate ?? ''} onChange={(e) => setDraft({ ...draft, subjectTemplate: e.currentTarget.value })} />
                <Textarea label="Message" required autosize minRows={8} maxLength={5000} value={draft.bodyTemplate ?? ''} onChange={(e) => setDraft({ ...draft, bodyTemplate: e.currentTarget.value })} />
                <Checkbox label="Needs a second person's approval before sending" checked={draft.requiresApproval} onChange={(e) => setDraft({ ...draft, requiresApproval: e.currentTarget.checked })} />
                <Checkbox label="Active" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })} />
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              {/* aria-live: screen readers announce the preview as it changes. */}
              <Paper p="md" bg="gray.0" aria-live="polite">
                <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb="xs">Preview</Text>
                <Text fw={600} mb="xs">{preview(draft.subjectTemplate) || '—'}</Text>
                <Text size="sm" className="pre-wrap">{preview(draft.bodyTemplate) || '—'}</Text>
              </Paper>
            </Grid.Col>
          </Grid>
        </EditorModal>
      )}
    </SectionCard>
  );
}
