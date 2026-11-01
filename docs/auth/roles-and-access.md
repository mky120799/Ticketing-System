# Roles and access

Who can do what in the platform. Every row below was checked against the code (`apps/api/src/auth/policy.service.ts` and the services that call it), not written from memory. The API is the authority: the console only hides buttons, it never grants anything.

If you are learning the implementation, read the standalone [Authentication](../modules/authentication/README.md), [Authorization](../modules/authorization.md), and [Audit](../modules/audit/README.md) guides alongside this document. They explain how the token becomes `UserContext`, how `PolicyService` evaluates the four checks below, and how both successful actions and authorization denials are recorded.

## 1. How access is decided

Every request passes four checks, in this order. A failure at any step is a 403 and is written to the audit trail.

| # | Check | What it means |
|---|---|---|
| 1 | **Role permission** | The role must hold the permission (table 3). Default-deny: no permission, no access. |
| 2 | **Scope** | The ticket must be in the user's **legal entity and country** and in one of their **queues**. |
| 3 | **Ownership / branch** | Agents (branch, call-centre, case) additionally need the ticket to be from **their branch**, or **created by or assigned to them**. Supervisors and auditors are scoped by queue only. |
| 4 | **Sensitivity** | Tickets marked `restricted` are visible to **supervisors and auditors only** (auditors read, never change). |

Some actions add extra rules on top:

- **Step-up login.** The user must have signed in recently (or with a stronger method). Applies to: revealing a customer reference, approving or rejecting, legal hold or retention changes, subject-access export, complaints-register CSV export, and audit-report export. In the local stack "recently" is within the last hour (`STEP_UP_MAX_AGE_SECONDS=3600`); a bank sets its own value or requires MFA.
- **Maker-checker.** The person who asked for something can never approve it.
- **Stale-edit protection.** An edit or assignment based on out-of-date data is refused (409).
- **Workflow role limits.** A status change must be allowed by the ticket's workflow, and some transitions are limited to certain roles (for example, only a supervisor can cancel).

Roles and scope come from the identity provider's token (`roles`, `branch`, `queues`, `department`, `legal_entity`, `country`). A token missing any of them is denied. Administrators have no case permissions at all, by design.

## 2. The roles at a glance

| Role | Who they are | Sees case content? | Can change cases? | Can change configuration? | Demo login |
|---|---|---|---|---|---|
| **branch-agent** | Branch staff who log customer issues | Their branch's tickets, in their queues | Create only | No | `local-branch-agent` |
| **call-center-agent** | Phone staff who log customer issues | Same as branch-agent | Create only | No | none seeded (same permissions as branch-agent) |
| **case-agent** | Handles the work | Their branch's tickets (or ones they created or own), in their queues | Yes: work the case | No | `local-case-agent`, `local-case-agent-2` |
| **supervisor** | Team lead / approver | All tickets in their queues, **including restricted** | Yes, plus assign, approve, hold, reveal, regulatory decisions | No | `local-supervisor` |
| **auditor** | Internal audit / compliance reviewer | All tickets in their queues, **including restricted** (read-only) | **No** | No | `local-auditor` |
| **administrator** | Platform / configuration owner | **No ticket content at all** | No | **Yes** | `local-admin` |
| **customer** (portal) | The bank's customer | Only their own requests | Raise, reply | No | `local-customer` |
| Service identities | Machines, not people | No | One narrow job each | No | see section 6 |

Demo scope: the seeded staff users belong to branch `BLR-01`, legal entity `BANK-IN`, country `IN`. The two case agents and the branch agent only have queues `customer-support` and `payments`; supervisor, auditor and admin have all six queues. A bank replaces all of this with its own identity provider.

## 3. Permission matrix (what each role can do)

Legend: **✔** allowed within scope · **—** not allowed (403) · **step-up** needs a recent login · **◐** allowed with a limit (see the notes column).

### Working a ticket

| Action | branch-agent / call-center | case-agent | supervisor | auditor | administrator | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Create a ticket | ✔ | ✔ | ✔ | — | — | Must be for the user's own branch, department, entity, country and one of their queues. Needs an idempotency key. |
| List and search tickets | ✔ | ✔ | ✔ | ✔ | — | Search returns minimal fields only (no description, references or notes). Every listing is audited. |
| Open a ticket | ✔ | ✔ | ✔ | ✔ | — | Auditors and supervisors by queue; agents by branch or ownership. Restricted tickets: supervisors and auditors only. |
| Edit priority, description, custom fields | — | ✔ | ✔ | — | — | Refused if the ticket changed since it was loaded. |
| Assign a ticket / change its queue | — | — | ✔ | — | — | The target queue must be one of the supervisor's own. See the known gap in section 7. |
| Add an internal note | — | ✔ | ✔ | — | — | Blocked once a ticket has been de-identified. |
| Add a customer-visible note | — | ✔ | ✔ | — | — | Blocked when customer communications are blocked on the case. Counts as the first response for the SLA. |
| Change status | — | ◐ | ◐ | — | — | Only moves the ticket's workflow allows. **Cancel is supervisor-only.** Resolving needs a root cause (and an outcome for complaints and privacy requests). |
| Link tickets (duplicate, related, parent) | — | ✔ | ✔ | — | — | Needs update rights on the source and read rights on the target; cross-entity links are refused. |
| Upload an attachment | — | ✔ | ✔ | — | — | **Restricted** classification: supervisor only. The file is scanned for malware before anyone can download it. |
| Download an attachment | ✔ | ✔ | ✔ | ✔ | — | Anyone who can read the ticket, only after a clean scan. Time-limited link. |
| Reveal the full customer reference | — | — | ✔ step-up | — | — | Separate action, always audited. Everyone else sees it masked. |

### Customer communications and approvals

| Action | branch-agent / call-center | case-agent | supervisor | auditor | administrator | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Request a customer communication from a template | — | ✔ | ✔ | — | — | Approved templates only; blocked when communications are blocked on the case. |
| Resolution notice to the customer | automatic | automatic | automatic | — | — | Queued by the system when a ticket is resolved; a supervisor approves it (template setting). Skipped when communications are blocked. |
| Request an approval for an action | — | ✔ | ✔ | — | — | |
| Approve or reject | — | — | ✔ step-up | — | — | Never your own request (maker-checker). |

### Complaints and privacy (Australian compliance)

| Action | branch-agent / call-center | case-agent | supervisor | auditor | administrator | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Mark a ticket as a complaint, set vulnerability or systemic-issue flags | — | ✔ | ✔ | — | — | The clock starts from the time of receipt, not the time of marking. |
| Remove complaint status | — | — | ✔ | — | — | |
| Record external dispute scheme (AFCA) referral | — | — | ✔ | — | — | |
| Block or unblock customer communications (tipping-off control) | — | — | ✔ | — | — | The reason is kept in the audit trail only. |
| Set retention date or legal hold | — | — | ✔ step-up | — | — | A legal hold needs a reason and stops de-identification. |
| Subject-access export (APP 12) | — | — | ✔ step-up | — | — | Withholds blocked cases; internal notes are counted, not released. |
| Complaints register (view / CSV export) | — | — | ✔ (CSV: step-up) | ✔ (CSV: step-up) | — | |

### Oversight, audit and reporting

| Action | branch-agent / call-center | case-agent | supervisor | auditor | administrator | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Dashboard and trends | — | — | ✔ | ✔ | — | Aggregates only; no customer data. |
| Run an SLA recalculation now | — | — | ✔ (own queues) | — | ✔ (whole entity) | The scheduler also does this automatically. |
| Search the audit trail | — | — | — | ✔ | — | Scope: own entity, country and queues; includes restricted tickets. |
| View one ticket's audit report | — | — | — | ✔ | — | Hashes and operational data only, no customer content. |
| Export an audit report | — | — | — | ✔ step-up | — | Export itself is audited. |
| Run or view audit-chain verification, view signed anchors | — | — | — | ✔ | — | |
| Live updates stream, notification inbox | ✔ | ✔ | ✔ | ✔ | — | Only changes for tickets the user may read. |

### Configuration and operations

| Action | branch-agent / call-center | case-agent | supervisor | auditor | administrator | Notes |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Read queues, categories, SLA policies, templates | ✔ | ✔ | ✔ | ✔ | ✔ | Safe, active items only for non-admins. |
| Edit queues, categories, SLA policies, communication templates | — | — | — | — | ✔ | Audited; changes are published as events. |
| Manage queue members, assignment rules, escalation rules, intake channels | — | — | — | — | ✔ | |
| Edit workflows (lifecycles and which roles may do each move) | — | — | — | — | ✔ | A definition is rejected if some status can no longer reach a closing state. |
| Look up colleagues' names from their IDs (staff directory) | ✔ | ✔ | ✔ | ✔ | ✔ | Same entity and country only; staff names, no customer data. |
| List people who can be assigned work (assignee and queue-member pickers) | — | — | ✔ | — | ✔ | Case agents and supervisors in scope, optionally filtered by queue. |
| Read regulatory profiles (to pick one when marking a complaint) | — | ✔ | ✔ | — | ✔ | Labels and day counts only, filtered to the user's jurisdiction. |
| Edit regulatory profiles, business hours, holidays | — | — | — | — | ✔ | |
| View dead-lettered events, replay them | — | — | — | — | ✔ | |
| Read Prometheus metrics | — | — | — | — | — | Needs a separate machine token, not a user role. |

## 4. In plain words

- **Branch agent / call-centre agent**: logs the issue and can follow it. Cannot touch it afterwards, add notes, send messages or see other branches' tickets.
- **Case agent**: does the work: notes, status, attachments, customer messages (some need approval), complaint flags. Cannot assign, approve, reveal references, place holds, or see restricted tickets.
- **Supervisor**: runs the queues. Assigns, approves what others request (never their own), reveals references, sets holds, makes the regulatory decisions, sees restricted tickets and exports subject-access data. Cannot see the audit console or change configuration.
- **Auditor**: reads and verifies, never changes. Sees tickets, the dashboard, the complaints register and the full audit trail with its integrity checks. Cannot edit, assign or approve anything. Can read restricted tickets, so sensitive cases can be checked.
- **Administrator**: configures the system and nothing else. Cannot open a ticket, read a note or see a customer reference. This separates "who sets the rules" from "who handles the cases".
- **Customer**: sees and replies to their own requests only, through a separate login and a separate identity realm.

## 5. Customer portal

The customer signs in to a separate identity realm and a separate API (`/v1/portal/*`). A staff token is rejected there, and a customer token is rejected on every staff route.

| Action | Customer |
|---|:-:|
| Raise a request, complaint or correction request | ✔ (up to 10 per hour) |
| See the list and status of **their own** requests | ✔ |
| Read bank replies sent to them and send a reply | ✔ (up to 30 messages per hour) |
| See anyone else's request | — (ownership is enforced by their account ID) |
| See internal notes, assignee, queue, SLA or internal status names | — (shown in plain language only) |
| Add documents (PDF, JPEG, PNG, text; 10 MB each, 10 per request, 20 per hour) to their own open request | ✔ (scanned; staff can open a file only after a clean scan) |

### Caller with a secure upload link (no account)

Staff (case agent, supervisor) send a *document request* message from the ticket; it carries a link valid for one request.

| Action | Link holder |
|---|:-:|
| Send up to 5 documents (PDF, JPEG, PNG, text; 10 MB each) to that one request | ✔ (scanned; staff can open a file only after a clean scan) |
| See the request, notes, other documents, or any other request | — (only the request reference, remaining count and the status of their own documents) |
| Use the link after it expires, is withdrawn, its message is rejected, or the request is closed | — (same plain refusal in every case) |

## 6. Service identities (machines)

These are not people. Each has one permission, no ticket-context claims, and is exempt from step-up because it cannot answer a login prompt.

| Identity | Single permission | Used for |
|---|---|---|
| `intake-gateway` | Create tickets through `POST /v1/intake/{channel}` | Email, portal, mobile and phone adapters |
| `attachment-scanner` | Record a malware scan result | The scanning worker |
| `integration-reconciler` | Record a receipt for a published event | Downstream systems confirming delivery |
| `notification-provider` | Record sent / delivered / failed for a communication | Email and SMS gateways |
| `system:*` actors | Internal scheduler jobs (SLA, escalation, retention, verification) | Appear in the audit trail with the `system:` prefix |

## 7. Known gaps and cautions

- **The assignee is not validated.** The assign API takes the agent ID as free text. It checks the supervisor's queue scope, but not that the agent exists, belongs to the target queue, or can open the ticket. (Automatic assignment only picks configured queue members.)
- **Step-up is configuration.** If `STEP_UP_MAX_AGE_SECONDS` and `STEP_UP_ACR_VALUES` are both unset, the step-up actions do not ask for a fresh login. The local stack sets one hour; production must set it (ideally with an MFA level).
- **Workflow role limits are thin by default.** The seeded `standard` workflow restricts only cancellation to supervisors. Approval-before-resolve and similar guards are not built (listed in the readiness document).
- **Auditors can read restricted tickets** (decided and built, see implementation log entry 26). A bank that wants a separate, tighter audit entitlement can change one line in `PolicyService`.
- **No skills, shift or absence awareness** in assignment yet.
- Demo logins and their shared password exist only in the development realm and must never reach a shared environment.
