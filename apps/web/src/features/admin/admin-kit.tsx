/**
 * Shared pieces for the administration screens. Every configuration area follows one pattern:
 *
 *   SectionCard (title, explanation, "New" button)
 *     └─ a table of existing items, each with "Edit"
 *   EditorModal (opened by New/Edit) → a form → Save → the list refreshes
 *
 * `useConfigList` and `useConfigSave` wrap TanStack Query so each section only says WHAT to load and save.
 */
import type { FormEvent, ReactNode } from 'react';
import { Badge, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { getCategories, getQueues } from '../../api';
import { humanize } from '../../lib/format';
import { notifySuccess } from '../../lib/notify';
import { queryKeys } from '../../lib/query-keys';
import { useSignedInUser } from '../../session/session-provider';

/** Loads one configuration list, cached under ['config', name, ...args]. */
export function useConfigList<T>(name: string, load: (user: User) => Promise<T>, options: { args?: string[]; enabled?: boolean } = {}) {
  const user = useSignedInUser();
  return useQuery({ queryKey: queryKeys.config(name, ...(options.args ?? [])), queryFn: () => load(user), enabled: options.enabled ?? true });
}

/** Saves an item, then refreshes the list(s) named in `refresh` and shows a confirmation. */
export function useConfigSave<T>(save: (user: User, item: T) => Promise<unknown>, refresh: string[], message: (item: T) => string) {
  const user = useSignedInUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: T) => save(user, item),
    onSuccess: async (_result, item) => {
      await Promise.all(refresh.map((name) => queryClient.invalidateQueries({ queryKey: queryKeys.config(name) })));
      notifySuccess(message(item));
    }
  });
}

/** Queue and category keys in scope, for drop-downs. */
export function useScopeOptions() {
  const queues = useConfigList('queues', getQueues);
  const categories = useConfigList('categories', getCategories);
  return {
    queues: queues.data?.map((q) => q.queue) ?? [],
    categories: categories.data?.map((c) => c.category) ?? []
  };
}

/** Turns keys into { value, label } options for NativeSelect. */
export const toOptions = (values: readonly string[]) => values.map((value) => ({ value, label: humanize(value) }));

export const ActiveBadge = ({ active }: { active: boolean }) => <Badge size="sm" variant="light" color={active ? 'green' : 'gray'}>{active ? 'Active' : 'Inactive'}</Badge>;

/** The pop-up form used to create or edit any configuration item. */
export function EditorModal({ title, opened, onClose, onSubmit, saving, children, size = 'md' }: { title: string; opened: boolean; onClose: () => void; onSubmit: () => void; saving: boolean; children: ReactNode; size?: string }) {
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={650} size="lg">{title}</Text>} size={size}>
      <form onSubmit={submit}>
        <Stack gap="md">
          {children}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={saving}>Save</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Small "Edit" button for table rows. */
export const EditButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <Button size="compact-xs" variant="subtle" onClick={onClick} aria-label={label}>Edit</Button>
);

/** A key like "premium-cards": lowercase letters, numbers and hyphens (what the API accepts). */
export const KEY_PATTERN = '[a-z0-9][a-z0-9-]+';
