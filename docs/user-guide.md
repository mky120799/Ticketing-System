# User guide

Plain-language guides by role. For screenshots and local demo logins, see the README.

## Staff console (`http://localhost:5173` in the demo stack)

**Signing in.** Choose *Sign in with SSO* and use your bank identity. You only see what your role, branch and queues allow. The header shows **● Live** when real-time updates are connected, and a bell with the number of unread notifications. If an action asks you to *sign in again*, that is a security check for sensitive actions; sign in and repeat it.

### Branch, call-centre and case agents
- **Create a ticket** (left): fill category, queue, branch, department, entity, country, subject, a customer reference (an opaque ID from the source system, never a card or account number), priority and description. Creating the same request twice does not create two tickets.
- **Find work** (middle): *Authorized tickets* lists the newest first; *Load more* pages back. Search covers subject, category, status and queue only.
- **Work a ticket** (right): read the masked details; add internal notes; move the status using the offered next steps (the workflow decides what is allowed). To **resolve**, choose a **root cause**; for a **complaint** also choose the **complaint outcome**.
- **Customer communications:** pick an approved template and enter the recipient reference. Some templates need a supervisor's approval before they can be sent. If a case shows *Customer communications: BLOCKED* you cannot message the customer (for example during an investigation).
- **Complaints:** the *Complaint and compliance* panel shows the regulatory status and deadlines. *Mark as complaint* starts the clock from when the bank first received it. You can flag a **vulnerable customer** or a **systemic issue**.
- **Attachments:** choose a file (PDF, JPEG, PNG or text, up to 25 MB). It is scanned for malware; **download is only offered once it is clean**.
- **Related tickets:** link duplicates, related and parent tickets by full ticket ID.
- **Stale edits:** if someone else changed the ticket while you had it open you will be told and the latest version is shown.

### Supervisors (in addition)
- **Approve or reject** communications that need a second person (you cannot approve your own).
- **Retention and legal hold:** place or lift a hold (a reason is required) and set a retention date.
- **Block or allow customer communications** on a case; **record an external dispute scheme referral** (with its reference) on a complaint.
- **Dashboard:** workload by queue, ageing, overdue, on-time rates, root causes, channels, open complaints, weekly trends, and the **complaints register export** (CSV).
- Receive notifications when approvals, deadlines or escalations need attention.

### Auditors
- **Audit tab:** shows whether the audit trail is intact ("Chain verified" or an integrity failure), the last published anchor, and lets you run a quick or full verification. **Search** audit events by person, action, outcome and time across tickets in your scope.
- On any ticket, *Audit trail* shows its events and hashes and can export them. Viewing and exporting are themselves audited.

### Administrators
- **Administration tab:** queue members, assignment rules, escalation rules, intake channels, regulatory profiles and public holidays, ticket workflows, and **integration events** (failed events and replay). Every change is audited with the previous value. Administrators have no access to case content by design.

## Customer portal (`http://localhost:5174` in the demo stack)
1. **Sign in** with your customer login.
2. **Tell us what happened:** choose *Make a request or ask a question* or *Make a complaint*, add a short summary and details, and **Send to the bank**. Please do not include full card numbers, passwords or PINs.
3. You get a **reference** such as `CASE-1A2B3C4D`. For a complaint you also see that it will be acknowledged and the date by which you will receive a final response.
4. **Your history** lists everything you raised. Open a request to read updates from the bank and **add a message** at any time.
You only ever see your own requests. Internal notes and staff details are never shown.

## By email
Write to the bank's case mailbox. Your message becomes a request and you receive an acknowledgement quoting a reference like `[CASE-1A2B3C4D]`. **Keep that reference in the subject** when you reply so your message joins the same request. Automatic replies and bulk mail are ignored.
