# User guide

Plain-language guides by role. For screenshots and local demo logins, see the README.

## Staff console (`http://localhost:5173` in the demo stack)

**Signing in.** Choose *Sign in with SSO* and use your bank identity. You only see what your role, branch and queues allow. If you opened a link to a particular ticket or screen, you land on it after signing in. The header shows a green **Live** badge when real-time updates are connected, a bell with the number of unread notifications, and your account menu (roles, *Sign out*). The left-hand menu only lists the screens your role can use; the bottom of it shows your branch, entity and queues. If an action asks you to *sign in again*, that is a security check for sensitive actions; sign in and repeat it.

**Every screen has its own address.** A ticket is `/tickets/<id>`, the queue keeps its filters in the address (for example `/tickets?view=mine&priority=high`), and the browser's Back button returns to exactly where you were. You can bookmark or share these links; the person opening one still only sees what their own access allows.

### Branch, call-centre and case agents
- **Tickets (the queue):** a table of the tickets in your queues, newest first, with status, priority, the next service-level due time, queue, assignee and age. Click a column heading to sort. Quick views across the top: *Open*, *Assigned to me*, *Unassigned*, *Overdue*, *Complaints*, *All* (each shows its count). Filter by status, priority or queue, or type in the search box (it searches subject, category, status and queue only, and shows basic fields). *Load more* fetches older tickets.
- **New ticket** (button, top right): subject, description, category (picking one pre-selects its usual queue), queue, priority, sensitivity, and a customer reference (an opaque ID from the source system, never a card or account number). Your branch, department, entity and country are filled in from your profile. Creating the same request twice does not create two tickets. The new ticket opens straight away.
- **Working a ticket:** the case screen shows the subject and its badges at the top (status, priority, service level, sensitivity, complaint, vulnerable customer, legal hold), the description in the middle, and a summary on the right (details, service-level due times, masked customer references). Case agents can correct the **description** and change the **priority** there.
  - **Change status** (top right) offers only the moves the ticket's workflow allows. To **resolve**, choose a **root cause**; for a **complaint** or privacy request also choose its **outcome**. A reason is optional and goes into the status history.
  - **Activity** tab: write an **internal note** (staff only) or a **reply to the customer** (shown in the portal, and counts as the first response). Below is one timeline of notes and status changes, newest first.
  - **Communications** tab: send a message from an approved template to a recipient reference. Some templates need a supervisor's approval. To ask a caller for documents, send the **document request email** or **SMS** template (the recipient is the customer's contact reference, for example `mailto:name@example.com` in the demo); it carries a secure link that lets them send documents to this request only. Resolving a ticket also queues the **resolution notice** automatically. Nothing can be sent while customer communications are blocked on the case.
  - **Attachments** tab: upload a PDF, JPEG, PNG or text file (up to 25 MB). Every file, including customers' documents, is scanned for malware; **download is only offered once it is clean**.
  - **Related** tab: link duplicates, related and parent tickets by full ticket ID (from the other ticket's address).
  - **Compliance** tab: regulatory status and deadlines. *Mark as complaint* starts the clock from when the bank first received the ticket. Flag a **vulnerable customer** or a **systemic issue**.
- **Branch and call-centre agents** can create and read tickets; the working actions above are for case agents and supervisors.
- **Stale edits:** if someone else changed the ticket while you had it open, you are told and the latest version is shown.

### Supervisors (in addition)
- **Assign** (top of a ticket): choose the queue, then search for a person by name (or *Assign to me*); leave the person empty to return it to the queue's pool. People appear by name once they have opened the console at least once; until then their short ID is shown.
- **Approve or reject** communications that need a second person, in the Communications tab (you cannot approve your own).
- **Reveal** customer references (right-hand panel): shows the full values once, needs a recent sign-in, and is recorded in the audit trail.
- **Retention** tab: place or lift a legal hold (a reason is required) and set a retention date.
- **Compliance** tab: **block or allow customer communications** on a case; **record an external dispute scheme referral**.
- **Dashboard:** headline numbers, open complaints and privacy requests (overdue numbers in red), created-vs-resolved trend chart, root causes, source channels, workload by queue, ageing, and breakdowns by category and branch. Every chart can be switched to a table. **Complaints register (CSV)** exports the last 90 days.
- Receive notifications when approvals, deadlines or escalations need attention.

### Auditors
- **Audit** screen: shows whether the audit trail is intact ("Chain verified" or an integrity failure), the last published anchor, and lets you run a quick or full verification. **Search** audit events by person, action, outcome and time across tickets in your scope; click an event to see its details and hash.
- On any ticket, the **Audit trail** tab shows its events and hashes and can export them. Viewing and exporting are themselves audited. Auditors can read but never change tickets.

### Administrators
- **Administration** opens on its own (administrators have no access to case content by design), with one tab per area: **Routing** (queue members, assignment rules, escalation rules), **Intake channels**, **Service levels** (SLA policies and business hours), **Compliance** (regulatory profiles and public holidays), **Workflows**, **Message templates** (with a live preview), and **Integration events** (failed events and replay). Each area lists what exists; *New* and *Edit* open a form. Every change is audited with the previous value.

## Customer portal (`http://localhost:5174` in the demo stack)
1. **Sign in** with your customer login.
2. **Tell us what happened:** choose *Make a request or ask a question*, *Make a complaint*, or *Ask us to correct information we hold about me*, add a short summary and details, and **Send to the bank**. Please do not include full card numbers, passwords or PINs.
3. You get a **reference** such as `CASE-1A2B3C4D`. For a complaint you also see that it will be acknowledged and the date by which you will receive a final response.
4. **Your history** lists everything you raised. Open a request to read the conversation with the bank (your messages on the right, the bank's on the left), **add a message** at any time, and **add a document** (PDF, JPEG, PNG or text, up to 10 MB). Documents show as *Being checked*, *Received* or *Not accepted*.
You only ever see your own requests. Internal notes and staff details are never shown.

## By email
Write to the bank's case mailbox. Your message becomes a request and you receive an acknowledgement quoting a reference like `[CASE-1A2B3C4D]`. **Keep that reference in the subject** when you reply so your message joins the same request. Automatic replies and bulk mail are ignored.
