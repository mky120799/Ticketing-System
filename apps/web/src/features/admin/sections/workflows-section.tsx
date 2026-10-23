/**
 * Workflows: the allowed status moves for each kind of ticket, optionally limited to certain roles.
 * The API rejects a workflow in which some status can never reach "closed" or "cancelled" (no dead ends).
 *
 * Each workflow is shown as a readable list of moves grouped by starting status. Editing uses JSON, checked as you
 * type, because a workflow is a small graph that does not fit a simple form.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconPencil, IconPlus } from '@tabler/icons-react';
import { getWorkflows, saveWorkflow, type WorkflowDefinition } from '../../../api';
import { SectionCard } from '../../../components/section-card';
import { EmptyState, LoadingBlock } from '../../../components/states';
import { humanize } from '../../../lib/format';
import { statusLook } from '../../../lib/labels';
import { ActiveBadge, EditorModal, KEY_PATTERN, useConfigList, useConfigSave } from '../admin-kit';

const EXAMPLE = JSON.stringify({ label: 'My workflow', active: true, transitions: [{ from: 'submitted', to: 'triage' }, { from: 'triage', to: 'cancelled', allowedRoles: ['supervisor'] }] }, null, 2);

/** Groups transitions by their starting status: { submitted: [...], triage: [...] }. */
function byFromStatus(workflow: WorkflowDefinition) {
  const groups = new Map<string, WorkflowDefinition['transitions']>();
  for (const t of workflow.transitions) groups.set(t.from, [...(groups.get(t.from) ?? []), t]);
  return [...groups.entries()];
}

export function WorkflowsSection() {
  const workflows = useConfigList('workflows', getWorkflows);
  const [editing, setEditing] = useState<{ key: string; json: string; isNew: boolean } | null>(null);
  const save = useConfigSave(saveWorkflow, ['workflows'], (w) => `Workflow "${w.workflowKey}" saved`);

  // Validate the JSON on every keystroke so mistakes show before saving.
  const parsed = useMemo(() => {
    if (!editing) return null;
    try {
      const body = JSON.parse(editing.json) as Omit<WorkflowDefinition, 'workflowKey'>;
      if (!Array.isArray(body.transitions)) return { error: '"transitions" must be a list' };
      return { body };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Invalid JSON' }; }
  }, [editing]);

  const open = (w: WorkflowDefinition) => setEditing({ key: w.workflowKey, json: JSON.stringify({ label: w.label, active: w.active, transitions: w.transitions }, null, 2), isNew: false });

  return (
    <SectionCard title="Workflows" description="Ticket lifecycles. A category uses one workflow; a move can be limited to roles (e.g. only supervisors cancel)."
      actions={<Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ key: '', json: EXAMPLE, isNew: true })}>New workflow</Button>}>
      {workflows.isPending ? <LoadingBlock rows={4} /> : !workflows.data?.length ? <EmptyState title="No workflows" /> : (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          {workflows.data.map((w) => (
            <Paper key={w.workflowKey} p="md" bg="gray.0">
              <Group justify="space-between" mb="sm">
                <Stack gap={0}><Title order={3} size="h6">{w.label}</Title><Text size="xs" c="dimmed">{w.workflowKey} · {w.transitions.length} moves</Text></Stack>
                <Group gap="xs"><ActiveBadge active={w.active} /><Button size="compact-xs" variant="subtle" leftSection={<IconPencil size={12} />} onClick={() => open(w)} aria-label={`Edit ${w.workflowKey}`}>Edit</Button></Group>
              </Group>
              <Stack gap={6}>
                {byFromStatus(w).map(([from, moves]) => (
                  <Group key={from} gap={6} align="flex-start" wrap="nowrap">
                    <Text size="xs" fw={600} w={120} style={{ flexShrink: 0 }}>{statusLook(from).label} →</Text>
                    <Group gap={4}>
                      {moves.map((m) => <Badge key={m.to} size="sm" variant="light" color={statusLook(m.to).color} title={m.allowedRoles?.length ? `Only: ${m.allowedRoles.join(', ')}` : undefined}>{statusLook(m.to).label}{m.allowedRoles?.length ? ' *' : ''}</Badge>)}
                    </Group>
                  </Group>
                ))}
              </Stack>
              {w.transitions.some((t) => t.allowedRoles?.length) && <Text size="xs" c="dimmed" mt="xs">* limited to certain roles</Text>}
            </Paper>
          ))}
        </SimpleGrid>
      )}
      {editing && (
        <EditorModal size="lg" title={editing.isNew ? 'New workflow' : `Workflow: ${editing.key}`} opened onClose={() => setEditing(null)} saving={save.isPending}
          onSubmit={() => { if (parsed && 'body' in parsed && parsed.body) save.mutate({ workflowKey: editing.key, ...parsed.body }, { onSuccess: () => setEditing(null) }); }}>
          <TextInput label="Workflow key" required pattern={KEY_PATTERN} disabled={!editing.isNew} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.currentTarget.value })} />
          <Textarea label="Definition (JSON)" required autosize minRows={12} maxRows={24} ff="monospace" value={editing.json} onChange={(e) => setEditing({ ...editing, json: e.currentTarget.value })}
            error={parsed && 'error' in parsed ? parsed.error : undefined}
            description={`Fields: label, active, transitions [{ from, to, allowedRoles? }]. Statuses: ${['submitted', 'triage', 'assigned', 'in_progress', 'pending_customer', 'resolved', 'closed', 'cancelled'].map(humanize).join(', ')}…`} />
        </EditorModal>
      )}
    </SectionCard>
  );
}
