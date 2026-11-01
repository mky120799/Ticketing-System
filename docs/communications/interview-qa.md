# Communications interview Q&A

[Back to Communications index](README.md)

---

## 30 seconds
> Customer messages are durable, governed records. A template decides whether a message is queued or needs maker-checker approval with step-up. A worker leases due rows with skip-locked selection, resolves the address from the bank's CRM at send time, renders allow-listed placeholders and sends. Results go through an idempotent, monotonic receipt API shared with external providers. Resolution notices are queued in the resolve transaction, and communication blocks stop everything.

## 2 minutes
> Creating a message checks ticket scope, redaction and the communication block, then loads an active template for that channel. Portal messages always go to the ticket's own portal reference. Document-request templates issue a secure upload link in the same transaction. Approval locks the approval row, requires supervisor scope, step-up and a different person, and then advances the linked communication. The delivery worker claims up to 10 queued rows with `FOR UPDATE SKIP LOCKED` and a 120-second lease, sends outside the transaction, retries with backoff and fails after five attempts. Receipts deduplicate on `(communication, provider, message ID, status)`, never move backwards, and are audited and published.

## Questions

**Q1. Why not send the email directly in the request?**
> Network calls inside a request or transaction are slow and unreliable. Persisting first gives a durable record, approval gating, retries and a clear status. The user sees "queued", not a false "sent".

**Q2. How do you prevent template authors leaking case data?**
> A regex allow-list on the DTO: only `{{ticketRef}}`, `{{status}}` and, in bodies, `{{uploadLink}}`. The renderer fills only those, escapes HTML and strips newlines from subjects.

**Q3. How do you stop two workers sending the same message?**
> Claim with `FOR UPDATE SKIP LOCKED` and push `next_attempt_at` forward as a lease in the same short transaction; other workers don't see it until the lease expires.

**Q4. Can a customer get a duplicate?**
> Yes, if the worker crashes after the provider accepted it but before the receipt was recorded. Delivery is at-least-once. Exactly-once across a DB and SMTP isn't possible; we prefer a rare duplicate to a lost notice.

**Q5. Why route the worker's results through the receipt endpoint logic?**
> One state machine and one audit path for internal and external providers, with the same idempotency and monotonic rules.

**Q6. Where are customer email addresses stored?**
> Mostly nowhere. We store opaque references and ask the CRM at send time. The exception is the `mailto:` reference on an inbound email's acknowledgement, which is needed to reply.

**Q7. What happens to a queued message when a supervisor blocks communications?**
> The worker checks the block at send time and fails it with `COMMUNICATION_BLOCKED`.

## Honest limitations
1. At-least-once delivery may duplicate.
2. Recipient references for email/SMS are typed by staff; a CRM picker would reduce errors.
3. Templates are last-write-wins and not versioned per message (a later edit changes how an unsent message renders).
