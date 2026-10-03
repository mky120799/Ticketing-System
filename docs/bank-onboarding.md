# Onboarding a new bank

The product is deployed single-tenant per bank. Onboarding is configuration, not code. Work through these in order; each step names where it is configured.

1. **Identity**: agree the claim contract (`docs/deployment.md`), register the web client (code + PKCE), create service clients for the scanner, reconciler, notification provider and intake gateway. Map the bank's groups to the platform roles.
2. **Legal entities and countries**: every user and queue carries `legal_entity` and `country`; data never crosses them. Decide the values.
3. **Queues and categories** (Administration or `/v1/configuration/queues`, `/categories`): departments, queues, and which category routes where.
4. **SLA policies** (`/v1/configuration/sla/...`): first-response and resolution minutes per priority.
5. **Regulatory profiles and holidays** (Administration): the clocks for complaints in the bank's jurisdiction; link complaint categories to a profile. Set `BUSINESS_TIMEZONE`.
6. **Workflows**: use the standard lifecycle or define per-category flows and role restrictions.
7. **Routing**: queue members, assignment rules, escalation rules.
8. **Communication templates**: channels, and which require maker-checker approval.
9. **Intake channels**: default category, queue, virtual branch and priority per channel; connect the adapters.
10. **Retention**: per-category years; agree schedules, then enable enforcement.
11. **Integrations**: set `OUTBOX_PUBLISHER=kafka` and the topic prefix; build adapters against the event envelope (`eventId` for de-duplication); object storage and malware scanner.
12. **Operations**: SIEM routes, alert rules (dead-letter outbox rows, overdue regulatory status, error rates), backup and restore test, runbooks.

Terminology that is bank- or market-specific (for example the name of the external dispute scheme) lives in the UI wording and configuration; the data model uses neutral terms.
