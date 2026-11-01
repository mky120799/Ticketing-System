# Compliance interview Q&A

[Back to Compliance index](README.md)

---

## 30 seconds
> Regulatory rules are configuration: profiles define acknowledgement and final-response deadlines per jurisdiction and case kind. A category's profile starts the clock at creation, and manual classification starts it from the original receipt time. A scheduler re-derives the regulatory status in skip-locked batches, raising notifications and escalation triggers. Resolving a regulated case needs a formal outcome. Supervisors control AFCA referrals and communication blocks, whose reasons stay in the audit trail only. Privacy exports and reports are scoped, step-up protected, minimised and audited.

## Questions

**Q1. Why store regulations as data?**
> Deadlines differ by country and change over time. Profiles let a bank configure or add jurisdictions without a release, and the code path stays the same.

**Q2. Why does the clock start at receipt even if classified later?**
> That's how the regulation counts. Otherwise, late classification would silently extend the bank's deadline.

**Q3. How are business days computed?**
> With a time-zone-aware calendar that skips weekends and configured holidays, keeping the time of day. Final response uses calendar days.

**Q4. What's the precedence in the status?**
> Final-response breach, then missed acknowledgement, then at risk, otherwise on track; resolved cases are judged on their resolution time.

**Q5. How do you avoid tipping off a fraud suspect?**
> A per-case communication block, on by default for fraud categories. It refuses customer notes and messages, fails already-queued deliveries at send time, skips resolution notices without prompting staff, and withholds the case from subject-access exports. The reason is in audit only.

**Q6. What does subject access release?**
> Customer-visible content within the supervisor's scope, with internal notes counted but not released, and blocked or redacted cases withheld for human review. It requires step-up, and the audit records counts, not the reference.

**Q7. How do you make CSV exports safe?**
> Prefix cells starting with `=`, `+`, `-`, `@`, tab or CR with `'` to neutralise formulas, and quote per RFC 4180. CSV export also requires step-up.

## Limitations
1. `BUSINESS_TIMEZONE` for regulatory clocks is global (Sydney default), not per country.
2. Correction requests have a clock and outcomes but no dedicated correction workflow.
3. Only AU profiles are seeded.
