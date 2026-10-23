/**
 * Query keys: the names under which TanStack Query caches server data.
 *
 * Keys are arrays and work like folders. Invalidating ['ticket', id] also invalidates ['ticket', id, 'audit'],
 * and invalidating ['tickets'] refreshes every ticket list (plain and searched). Building keys only through
 * this file keeps those relationships correct.
 */
import type { AuditFilters } from '../api';

export const queryKeys = {
  me: ['me'] as const,
  /** Every ticket list (the paged queue and each search). */
  ticketLists: ['tickets'] as const,
  ticketList: (search: string) => ['tickets', 'list', search] as const,
  ticket: (id: string) => ['ticket', id] as const,
  ticketAudit: (id: string) => ['ticket', id, 'audit'] as const,
  notifications: ['notifications'] as const,
  dashboard: ['dashboard', 'summary'] as const,
  trends: (weeks: number) => ['dashboard', 'trends', weeks] as const,
  chainStatus: ['audit', 'chain'] as const,
  auditSearch: (filters: AuditFilters) => ['audit', 'search', filters] as const,
  /** Configuration lists: ['config', 'queues'], ['config', 'members', 'payments'], ... */
  config: (name: string, ...args: string[]) => ['config', name, ...args] as const,
  communicationTemplates: ['config', 'communication-templates'] as const
};
