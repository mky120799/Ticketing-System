# End-to-end flows

Use these guides for “walk me through exactly what happens” interview questions. Each begins at a frontend action or worker tick and follows identity, controller/service, transaction, evidence, asynchronous processing and UI convergence.

## Identity and evidence

- [Staff authentication](staff-authentication.md)
- [Ticket change and audit](ticket-change-and-audit.md)
- [Audit report](audit-report.md)

## Customer and case lifecycle

- [Portal request and reply](portal-request-and-reply.md)
- [Attachment upload, scan and download](attachment-upload-and-scan.md)
- [Communication, approval and delivery](communication-approval-delivery.md)
- [Automatic assignment and escalation](assignment-and-escalation.md)
- [Retention redaction](retention-redaction.md)

## Integration reliability

- [Outbox publication and receipt](outbox-publish-and-receipt.md)

For a source-level completeness check, use the [22/22 module coverage matrix](../modules/source-coverage.md). For subsystem ownership, use the [application module index](../modules/README.md).

## How to read a flow

For every numbered step, identify:

1. the initiating React component, worker tick or provider callback;
2. identity/capability source and the first authorization decision;
3. DTO/protocol validation before business work;
4. service method and current resource/state checks;
5. exact transaction, lock/idempotency key and rows changed;
6. audit/outbox/notification/live effects and whether they are atomic;
7. asynchronous crash/retry window;
8. frontend refetch, cache invalidation and error recovery;
9. the test capable of proving the strongest guarantee;
10. a current limitation that should not be overclaimed.

Use the [data and consistency map](../modules/reference/data-and-consistency-map.md) when a flow crosses several modules.
