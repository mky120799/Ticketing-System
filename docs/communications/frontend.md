# Communications frontend

[Back to Communications index](README.md)

---

## 1. Communications tab (staff)

[communications-tab.tsx#L18-L92](../../apps/web/src/features/ticket/tabs/communications-tab.tsx#L18-L92)

| Part | Behaviour |
|---|---|
| History table | Template, channel, **masked** recipient, status badge ([labels.ts#L62-L66](../../apps/web/src/lib/labels.ts#L62-L66)), when |
| Approve / Reject buttons | Shown only for `pending_approval` rows with an `approvalId`, and only for `can('supervise')` ([L53-L58](../../apps/web/src/features/ticket/tabs/communications-tab.tsx#L53-L58)). The API still enforces step-up and maker-checker |
| Send form | Template select shows "(email) · needs approval" hints; recipient reference input (min 8 characters) |
| Blocked case | The form is replaced by a red alert ([L70-L71](../../apps/web/src/features/ticket/tabs/communications-tab.tsx#L70-L71)) |
| After send | Toast: "Queued. A supervisor must approve it before it is sent." or "Communication queued" ([L29](../../apps/web/src/features/ticket/tabs/communications-tab.tsx#L29)), never "sent" |

Templates come from `GET /configuration/communication-templates`, cached for 10 minutes on the client ([L21](../../apps/web/src/features/ticket/tabs/communications-tab.tsx#L21)) and 30 s in Redis on the server.

Both mutations use `useTicketMutation`, so the whole ticket is refetched after a send or decision and the new status appears. If the API says `step_up_required`, the shared banner appears ([auth/frontend-session.md](../auth/frontend-session.md#7-step-up-as-the-user-experiences-it)).

## 2. Template editor (administrators)

[templates-section.tsx#L17-L67](../../apps/web/src/features/admin/sections/templates-section.tsx#L17-L67):

- Table of all templates (including inactive) from `GET /configuration/communication-templates/all`.
- Editor with subject, body, "Needs a second person's approval", "Active".
- **Live preview** with sample values `CASE-1A2B3C4D` and "being worked on" ([L15](../../apps/web/src/features/admin/sections/templates-section.tsx#L15)), announced to screen readers through `aria-live`.
- Saving refreshes both the admin list and the staff template list keys ([L20](../../apps/web/src/features/admin/sections/templates-section.tsx#L20)).
- An invalid placeholder → 400 from the DTO regex, shown as a toast.

## 3. Portal view (customer)

The customer sees only portal messages in `sent`/`delivered` state, rendered from the template, merged with customer-visible notes into one "Updates" conversation ([portal.service.ts#L49-L53](../../apps/api/src/portal/portal.service.ts#L49-L53)). Pending, rejected and failed messages are never shown. See [Portal](../portal/README.md).

## 4. Interview answer

> Staff never compose free text to customers. The tab offers active templates, shows masked recipients and honest statuses (queued, awaiting approval, sent, delivered), and offers Approve/Reject only to supervisors, while the API enforces step-up and maker-checker. Administrators edit wording with a live preview, and the API rejects any placeholder outside the allow-list.

Next: [Interview Q&A](interview-qa.md)
