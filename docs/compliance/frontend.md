# Compliance frontend

[Back to Compliance index](README.md)

---

## 1. Compliance tab (on a ticket)

[compliance-tab.tsx#L26-L109](../../apps/web/src/features/ticket/tabs/compliance-tab.tsx#L26-L109)

| Section | Who | Behaviour |
|---|---|---|
| Not yet a complaint | `workTicket` | Explanation + profile picker (profiles for the user's country, loaded only when this form is visible) or a key input fallback; **Mark as complaint** |
| Complaint / privacy request | everyone who can read | Regulatory badge, profile, acknowledge-by, final-response-by, outcome |
| Flags | `workTicket` | Toggle vulnerable customer and systemic issue (re-sends the existing profile so the clock isn't reset, [L44-L45](../../apps/web/src/features/ticket/tabs/compliance-tab.tsx#L44-L45)) |
| External dispute scheme | `supervise` | Status + reference, **Record referral** |
| Customer communications | `supervise` | **Block / Lift block**, with "The reason is kept in the audit trail only" |

The tab label turns **red** when the regulatory status is at risk or overdue ([ticket-page.tsx#L53](../../apps/web/src/features/ticket/ticket-page.tsx#L53), [L71](../../apps/web/src/features/ticket/ticket-page.tsx#L71)). Badges use one colour table ([labels.ts#L43-L47](../../apps/web/src/lib/labels.ts#L43-L47)). The header shows "Complaint", "Vulnerable customer", "Communications blocked" and "Legal hold" badges ([ticket-header.tsx#L38-L42](../../apps/web/src/features/ticket/ticket-header.tsx#L38-L42)).

All actions use `useTicketMutation`: refetch on success, refetch on 409.

## 2. Queue indicators

The queue table shows a complaint icon and a vulnerable-customer icon next to the subject ([ticket-table.tsx#L29-L30](../../apps/web/src/features/tickets/ticket-table.tsx#L29-L30)), and a "Complaints" quick view.

## 3. Admin: compliance section

[compliance-section.tsx](../../apps/web/src/features/admin/sections/compliance-section.tsx):

- **Regulatory profiles** ([L20-L65](../../apps/web/src/features/admin/sections/compliance-section.tsx#L20-L65)): table + editor (key, jurisdiction, label, acknowledge business days, final-response days, at-risk days, active).
- **Public holidays** ([L67-L90](../../apps/web/src/features/admin/sections/compliance-section.tsx#L67-L90)): list + add form (date, name). These are used by both the regulatory and the SLA business calendars.

## 4. Dashboard

Complaint tiles (open, acknowledgement overdue, at risk, final response overdue, vulnerable, with external scheme, privacy requests open/overdue) and the CSV register download. See [Dashboard](../dashboard/README.md).

## 5. Portal

Customers see "We have acknowledged your complaint. You will receive our final response by <date>." ([request-detail.tsx#L44-L49](../../apps/portal/src/components/request-detail.tsx#L44-L49)).

Next: [Interview Q&A](interview-qa.md)
