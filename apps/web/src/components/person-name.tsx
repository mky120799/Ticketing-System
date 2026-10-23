/**
 * Showing people by name.
 *
 * Tickets and the audit trail store a person's subject ID from the identity provider (for example
 * "dd8a043a-e38f-4025-..."): it never changes, even if their name does. For display we ask the API's staff directory
 * to turn IDs into names.
 *
 * Batching: a table with 50 rows renders 50 <PersonName>s at once. Instead of 50 requests, the requests made within
 * the same few milliseconds are collected and sent as ONE call, and each name is then cached (TanStack Query) so the
 * same person is never looked up twice.
 */
import { Text, Tooltip, type TextProps } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { lookupNames } from '../api';
import { useSignedInUser } from '../session/session-provider';

// --- the batcher -------------------------------------------------------------

type Waiter = (name: string | null) => void;
let waiting = new Map<string, Waiter[]>();
let flushScheduled = false;

/** Asks for one name; the actual request goes out a moment later together with any others asked for meanwhile. */
function requestName(user: User, subject: string): Promise<string | null> {
  return new Promise((resolve) => {
    waiting.set(subject, [...(waiting.get(subject) ?? []), resolve]);
    if (!flushScheduled) { flushScheduled = true; setTimeout(() => void flush(user), 10); }
  });
}

async function flush(user: User): Promise<void> {
  const batch = waiting; waiting = new Map(); flushScheduled = false;
  const subjects = [...batch.keys()];
  // The API accepts up to 200 IDs per call.
  for (let start = 0; start < subjects.length; start += 200) {
    const chunk = subjects.slice(start, start + 200);
    let names: Record<string, string> = {};
    try { names = await lookupNames(user, chunk); } catch { /* names are a nicety: on failure the ID is shown instead */ }
    for (const subject of chunk) for (const resolve of batch.get(subject) ?? []) resolve(names[subject] ?? null);
  }
}

// --- labels for actors that are not people -----------------------------------

/** Automatic actions and customers are recorded with a prefix rather than a person's ID. */
function machineLabel(id: string): string | null {
  if (id.startsWith('system:')) return `Automatic (${id.slice(7)})`;
  if (id === 'customer:portal') return 'Customer (portal)';
  if (id === 'customer:link') return 'Customer (secure link)';
  if (id.startsWith('customer:')) return 'Customer';
  return null;
}

/** The display name for a subject ID, or null while loading / when the directory does not know the person. */
export function usePersonName(id: string | null | undefined): { name: string | null; loading: boolean } {
  const user = useSignedInUser();
  const machine = id ? machineLabel(id) : null;
  const query = useQuery({
    queryKey: ['person', id],
    queryFn: () => requestName(user, id!),
    enabled: Boolean(id) && !machine,
    staleTime: 600_000 // names rarely change: keep them for 10 minutes
  });
  return { name: machine ?? query.data ?? null, loading: query.isPending && Boolean(id) && !machine };
}

/**
 * A person's name, with their exact ID in a tooltip (auditors sometimes need the ID itself). If the directory does not
 * know them yet (they have never opened the console) the shortened ID is shown and the tooltip explains why.
 */
export function PersonName({ id, empty = '—', ...textProps }: { id: string | null | undefined; empty?: string } & TextProps) {
  const { name, loading } = usePersonName(id);
  if (!id) return <Text size="sm" c="dimmed" span {...textProps}>{empty}</Text>;
  const label = name ?? (loading ? '…' : `${id.slice(0, 8)}…`);
  const tip = name ? id : 'Not in the staff directory yet: this person has not opened the console. Their ID is ' + id;
  return (
    <Tooltip label={tip} multiline maw={320}>
      <Text size="sm" span c={name ? undefined : 'dimmed'} {...textProps}>{label}</Text>
    </Tooltip>
  );
}
