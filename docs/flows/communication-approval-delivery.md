# Flow: customer communication, approval and delivery

1. Case agent opens Communications tab and selects an active channel template plus recipient reference.
2. API authenticates, checks ticket update scope, redaction and communication block, then reloads the active template.
3. Service inserts `ticket_communications` as `queued` or `pending_approval`. Recipient is stored masked for responses; portal recipient is derived from the ticket.
4. If approval is required, it inserts linked `approval_requests`, audit/outbox and supervisor notification in the same transaction.
5. Supervisor decision locks approval, checks `ticket:approve`, step-up and maker-checker, then marks approval and linked communication queued/rejected with evidence.
6. Delivery worker leases queued communication, resolves contact/rendered template and calls provider.
7. Worker/provider receipt records sent/delivered/failed through Integration service. Receipts are idempotent and status cannot move backward.
8. Staff tab refetches and displays durable state. Customer portal includes only eligible delivered/customer-visible output.

For a document-request template, upload-link row is created with the communication; the capability resolves only once communication is queued/sent/delivered.

For resolution, `ResolutionNoticeService` executes step 2–4 automatically inside the status transaction or audits why it skipped.

## Failure reasoning

- POST success means durable queued/pending state, not provider delivery.
- Two approvers serialize on the approval row; self-approval is always denied.
- Worker crash after provider acceptance may redeliver; stable communication id/provider idempotency is needed.
- Duplicate provider callback returns stored receipt; contradictory callback conflicts.
- Communication block prevents creation/delivery path according to domain rule.

## Interview answer

> I persist communications before delivery. Template policy decides queued versus pending approval. Approval is a locked maker-checker transaction with step-up and atomically advances the communication. A leased worker sends asynchronously, and idempotent receipts move delivery state monotonically. The UI displays database state, never assumes that creating a message means the customer received it.
