# Audit testing

Audit tests need to prove transaction coupling, immutability, hash integrity, scope and sensitive frontend behavior.

## Event-write tests

- A successful ticket/configuration/compliance mutation creates exactly one expected audit event.
- Throwing after a domain update or audit insert rolls back both business state and evidence.
- Concurrent audit writers produce one continuous chain because the advisory lock serializes head selection.
- Metadata normalization produces the same hash when recomputed from stored JSON/timestamp fields.
- Bounded request context is included; tokens and customer free text are absent.
- A `403` produces `authorization.denied` even though the business transaction rolled back.

## Database and integrity tests

[`roles.integration-spec.ts`](../../../apps/api/test/roles.integration-spec.ts) proves the runtime role can append through its allowed path but cannot update, delete or truncate audit rows. [`production-safety.spec.ts`](../../../apps/api/test/production-safety.spec.ts) proves restricted-role requirements in production.

Integrity cases should mutate a controlled test database as the owner and prove detection of changed content, broken previous hash, deleted middle event, truncated anchored tail, invalid/missing post-signing signature, archive base continuation and valid legacy rows. Test incremental and full verification separately.

## API policy tests

Seed tickets across entities, countries and queues; prove an auditor sees only permitted events and can read restricted tickets in scope. Test action escaping, date filters, cursor limit, report bounds, missing ticket, non-auditor denial and step-up export. Verify that search, verification and export create their own audit events without leaking result data.

## Frontend tests

Build/typecheck ensures response types remain aligned. Behavioral tests should cover filter/query-key changes, cursor pagination, empty/invalid chain states, one verification request while pending, 403 rendering and the step-up → reauthenticate → return flow for export.

## Interview answer

> I test audit as evidence, not just another insert. Integration tests prove a failed business transaction leaves neither change nor audit row, concurrent writers preserve one chain, and the runtime DB role cannot rewrite evidence. Integrity tests intentionally corrupt rows or truncate an anchored tail and expect verification failure. API tests prove auditor scope and step-up, while frontend tests prove exports use the dedicated server endpoint.
