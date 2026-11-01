# Intake interview Q&A

[Back to Intake index](README.md)

---

## 30 seconds
> Adapters normalise channel messages and authenticate as a narrow intake identity. `IntakeService` serialises on channel plus message ID with an advisory lock and checks a persisted ledger with a content hash, so redelivery returns the original ticket and conflicting reuse is refused. Routing never leaves the channel's entity or country, and creation follows the same SLA, audit, outbox, compliance and assignment path as staff tickets. Email adds loop protection, HMAC sender pseudonyms, rate limits and ownership-checked threading.

## Questions

**Q1. How do you guarantee one external message → one ticket?**
> A ledger `(channel, message_id) → request_hash, ticket_id`, written in the ticket's transaction, plus an advisory lock keyed by channel and message ID, so concurrent redeliveries serialise. The same hash returns the original; a different hash is a 409.

**Q2. Why lock here but not in the staff-create path?**
> Here the key is known before the transaction, so a transaction-scoped advisory lock on it is cheap. The staff path relies on the primary key as a final guard; adding the same lock there would close its first-use race too.

**Q3. Why HMAC for email senders instead of a plain hash?**
> A plain hash of an email address can be reversed by hashing a list of known addresses. A keyed HMAC can't be reversed without the server secret, yet it's stable for matching.

**Q4. How do you avoid mail loops?**
> Ignore mail with RFC 3834 `Auto-Submitted`, bulk or list precedence, list and auto-reply headers, bounce reports, no-reply senders and our own address. Mark our outbound mail as auto-generated.

**Q5. How do you stop someone injecting notes into another customer's ticket by quoting a case number?**
> Threading requires the case tag **and** that the sender's HMAC reference is a reference on that ticket. Otherwise it's a new ticket.

**Q6. Why doesn't a customer reply count as a first response?**
> The SLA measures the bank responding. If customer replies counted, a customer could stop the bank's clock.

**Q7. What if processing an email fails halfway?**
> It isn't marked seen, so the next pass retries; the ledger makes the retry idempotent.

## Limitations
1. Email attachments are dropped (customers are guided to the portal or a secure link).
2. Only the first 20 unread messages are processed per pass.
3. External adapters (mobile, phone) are not included; only their contract and endpoint exist.
