# Audit event model and transaction boundary

An audit record is evidence, not a debug log. It answers who performed which action, against what target, under which request, with what outcome and chain position—without copying unnecessary customer content.

## Input and stored fields

[`AuditService`](../../../apps/api/src/audit/audit.service.ts) accepts:

```ts
interface AuditInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  correlationId: string;
  outcome: 'success' | 'denied';
  metadata?: Record<string, string | number | boolean | null>;
}
```

The stored row adds UUID `id`, monotonic `sequence`, database-normalized occurrence time, `previous_hash`, `event_hash` and `hash_version`. `actorId` is the stable OIDC subject or an explicit `system:*` actor. Action names use a bounded namespace such as `ticket.status_changed`.

Metadata contains facts needed to understand the decision: previous/next status, queue, counts, classification or feature flag. It must not contain note bodies, descriptions, raw customer references, bearer tokens or entire before/after entities.

## Request context

[`request-context.ts`](../../../apps/api/src/audit/request-context.ts) creates an `AsyncLocalStorage` record at Fastify `onRequest` with bounded IP/user-agent. After authentication, `AuthGuard` adds token id, ACR and authentication time. `AuditService.write` merges those request facts into normalized metadata without passing them through every controller signature.

The metadata is serialized/deserialized before hashing so its representation matches what PostgreSQL stores and later verification reads.

## Atomic write path

Domain services pass their active `PoolClient`:

```ts
return db.transaction(async (client) => {
  await client.query('UPDATE tickets ...', values);
  await audit.write(client, {
    actorId: user.subject,
    action: 'ticket.status_changed',
    targetType: 'ticket',
    targetId: ticketId,
    correlationId,
    outcome: 'success',
    metadata: { fromStatus, toStatus },
  });
  await outbox.enqueue(client, event);
});
```

`write` acquires transaction advisory lock `804231`, reads the latest event hash, creates id/time, computes the version-2 hash over every stored field plus previous hash and inserts `audit_events`. The lock serializes chain-head selection across concurrent business transactions. If the audit insert fails, the ticket and outbox changes roll back; there is no successful material change without its evidence.

When `AUDIT_STREAM_ENABLED=true`, the same transaction inserts a minimized `audit.event` outbox record for SIEM delivery. Metadata streaming is off unless explicitly enabled.

## Denied actions

A forbidden service throws before/while its business transaction rolls back. [`DeniedAuthorizationInterceptor`](../../../apps/api/src/audit/denied-authorization.interceptor.ts) catches the resulting `403` and writes `authorization.denied` in a new transaction, then rethrows the original error. This is intentionally separate: the denial evidence must survive even though no business change commits.

Authentication failures are generally not written to the protected actor audit chain because no trusted actor exists; they belong in rate-limited security/edge logs with no raw token.

## Previous configuration values

`AuditService.previous` reads a caller-controlled table/where expression, removes routine update metadata, serializes and truncates to 1,500 characters. It is used only with fixed code strings—not user-supplied table or SQL names—to record bounded configuration before-state.

## Interview answer

> Every material service passes its transaction client to `AuditService`, so business state, audit evidence and outbox event commit or roll back together. The audit writer serializes chain-head access with an advisory transaction lock and hashes the normalized stored fields plus the previous hash. Denied authorization is written by an interceptor in a separate transaction because the failed business transaction rolls back. Metadata is intentionally bounded and excludes customer free text and secrets.
