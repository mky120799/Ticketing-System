# Regulatory clocks and case controls

[Back to Compliance index](README.md) · Code: [compliance.service.ts](../../apps/api/src/compliance/compliance.service.ts)

---

## 1. Profiles as data

`regulatory_profiles(profile_key, label, jurisdiction, case_kind, acknowledge_business_days, final_response_calendar_days, at_risk_days, active)`, with a CHECK keeping the numbers sane ([migration …18000#L7-L17](../../apps/api/migrations/1710000018000_regulatory_complaints.cjs#L7-L17)).

Seeded:

| Key | Kind | Acknowledge | Final response | At risk |
|---|---|---|---|---|
| `au-rg271-standard` | complaint | 1 business day | 30 days | last 5 days |
| `au-rg271-hardship` | complaint | 1 business day | 21 days | last 4 days |
| `au-app13-correction` | privacy_request | 5 business days | 30 days | last 5 days |

Categories link to profiles: `complaint → au-rg271-standard`, `privacy-correction → au-app13-correction`. `fraud-case` blocks communications by default.

Admin CRUD ([upsertProfile L156-L172](../../apps/api/src/compliance/compliance.service.ts#L156-L172)): the profile's jurisdiction **must equal the administrator's country**, and a profile owned by another jurisdiction can't be edited. Case workers can read profiles for their country (needed to pick one when marking a complaint, [listProfiles L149-L154](../../apps/api/src/compliance/compliance.service.ts#L149-L154)).

---

## 2. Starting the clock

[startClock, L210-L219](../../apps/api/src/compliance/compliance.service.ts#L210-L219):

```ts
const profile = SELECT ... FROM regulatory_profiles WHERE profile_key=$1;  if (!active) 409;
const holidays = SELECT holiday_date FROM business_holidays WHERE country=$1;
const acknowledgeDueAt   = addBusinessDays(receivedAt, profile.acknowledge_business_days, BUSINESS_TIMEZONE, holidays);
const finalResponseDueAt = new Date(receivedAt + profile.final_response_calendar_days days);
UPDATE tickets SET is_complaint = (case_kind='complaint'), case_kind, regulatory_profile, acknowledge_due_at, final_response_due_at, regulatory_status='on_track';
audit ticket.regulatory_clock_started · outbox ticket.regulatory_clock_started
```

Two entry points:

| Entry | When | Code |
|---|---|---|
| `applyAtCreation` | The category has a profile (or blocks communications) | [L38-L43](../../apps/api/src/compliance/compliance.service.ts#L38-L43), called by [tickets create](../../apps/api/src/tickets/tickets.service.ts#L55) and [intake](../../apps/api/src/intake/intake.service.ts#L60) |
| `classify` | Staff mark an existing ticket as a complaint | [L45-L65](../../apps/api/src/compliance/compliance.service.ts#L45-L65) |

**Key rule:** "The clock runs from receipt, not from the moment someone noticed it was a complaint" ([L50-L51](../../apps/api/src/compliance/compliance.service.ts#L50-L51)), so `receivedAt = ticket.created_at`. Late classification can't buy the bank extra time.

`BUSINESS_TIMEZONE` defaults to `Australia/Sydney` ([L15](../../apps/api/src/compliance/compliance.service.ts#L15)).

### Classify details

- Marking requires a profile key (400 otherwise).
- **Removing** complaint status: supervisor only ([L53](../../apps/api/src/compliance/compliance.service.ts#L53)); clears profile, dates and status.
- Vulnerability and systemic flags can be set in the same call (`COALESCE` keeps unchanged values).
- Audit includes the free-text `reason` (stays in audit); the outbox carries only IDs and booleans.

---

## 3. Status formula

[statusSql, L18-L23](../../apps/api/src/compliance/compliance.service.ts#L18-L23):

```sql
CASE
  WHEN t.resolved_at IS NOT NULL THEN CASE WHEN t.resolved_at <= t.final_response_due_at THEN 'met' ELSE 'final_response_overdue' END
  WHEN now() > t.final_response_due_at                                         THEN 'final_response_overdue'
  WHEN t.first_responded_at IS NULL AND now() > t.acknowledge_due_at           THEN 'ack_overdue'
  WHEN now() > t.final_response_due_at - (p.at_risk_days * interval '1 day')   THEN 'at_risk'
  ELSE 'on_track' END
```

"Final-response breach beats missed acknowledgement beats at-risk" ([comment L17](../../apps/api/src/compliance/compliance.service.ts#L17)). Acknowledgement = `first_responded_at` (the same "first customer-facing action" as the SLA).

### Reconcile (scheduler)

[reconcile, L92-L109](../../apps/api/src/compliance/compliance.service.ts#L92-L109): the same shape as the SLA reconciler. `UPDATE ... FROM regulatory_profiles` for up to 500 open regulated tickets whose status would change, `FOR UPDATE OF t2 SKIP LOCKED`; per changed row: audit `ticket.regulatory_<status>` by `system:regulatory-clock`, outbox, live `ticket.sla_changed`, and for `ack_overdue`, `at_risk` and `final_response_overdue` a `regulatory_at_risk` notification to the assignee and supervisors. Escalation rules can trigger on these states ([escalation](../assignment-and-routing/escalation.md)).

---

## 4. Resolving needs an outcome

[tickets.service.ts#L175-L178](../../apps/api/src/tickets/tickets.service.ts#L175-L178): if the ticket has a `regulatory_profile`, resolving requires `idrOutcome` from the right list (privacy vs complaint, [compliance.dto.ts#L3-L6](../../apps/api/src/compliance/compliance.dto.ts#L3-L6)). A DB CHECK also restricts `idr_outcome` values. Reopening clears it.

---

## 5. AFCA (external dispute)

[afca, L67-L78](../../apps/api/src/compliance/compliance.service.ts#L67-L78): `POST /v1/tickets/:id/afca` `{ status: referred|open|closed, reference? }`.

- `ticket:approve` (supervisor) in scope.
- Only complaints (409 otherwise).
- A reference is required once referred or open (if none is stored yet); format `[A-Za-z0-9._-]`.
- Audit, outbox and a live update.

## 6. Communication block

[setCommunicationBlock, L80-L89](../../apps/api/src/compliance/compliance.service.ts#L80-L89): supervisor (`ticket:approve`), `{ blocked, reason }`. **The reason is kept in the audit trail only, never in outbox events, because it may describe a sensitive investigation** ([L84](../../apps/api/src/compliance/compliance.service.ts#L84)). The effects across the system are listed in [communications → block](../communications/creating-and-approving.md#4-communication-block-tipping-off).

## 7. Routes

[compliance.controller.ts#L11-L22](../../apps/api/src/compliance/compliance.controller.ts#L11-L22): ticket routes use `ParseUUIDPipe` for `:ticketId`.

| Route | Purpose |
|---|---|
| `PUT /tickets/:id/complaint` | classify / flags |
| `POST /tickets/:id/afca` | dispute scheme |
| `PUT /tickets/:id/communication-block` | tipping-off control |
| `POST /privacy/subject-access` | [subject access](reports-and-privacy.md) |
| `GET /reports/complaints` | [register](reports-and-privacy.md) |
| `GET/PUT /configuration/regulatory-profiles[/:key]` | profiles |
| `GET/PUT /configuration/business-hours` | working hours |
| `GET /configuration/holidays`, `PUT /configuration/holidays/:date` | holidays |

## 8. Tests

| Claim | Test |
|---|---|
| Complaint clock, tipping-off block, register export | [workflow.integration-spec.ts#L107](../../apps/api/test/workflow.integration-spec.ts#L107) |
| Correction request has its own clock and outcomes | [portal.integration-spec.ts#L146](../../apps/api/test/portal.integration-spec.ts#L146) |
| Business-day math | [business-calendar.spec.ts](../../apps/api/test/business-calendar.spec.ts#L3-L9) |

Next: [Reports and privacy](reports-and-privacy.md)
