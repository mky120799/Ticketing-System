import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, so the same data always hashes the same regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export interface AuditHashInput {
  id: string; occurredAt: Date; actorId: string; action: string; targetType: string; targetId: string; correlationId: string;
  outcome: string; metadata: Record<string, unknown>; previousHash: string | null;
}

/** Version 2 event hash: covers identity, time, actor, target, outcome, metadata and the previous event's hash. */
export function computeEventHashV2(input: AuditHashInput): string {
  const canonical = stableStringify({ v: 2, id: input.id, occurredAt: input.occurredAt.toISOString(), actorId: input.actorId, action: input.action, targetType: input.targetType, targetId: input.targetId, correlationId: input.correlationId, outcome: input.outcome, metadata: input.metadata, previousHash: input.previousHash });
  return createHash('sha256').update(canonical).digest('hex');
}
