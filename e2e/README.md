# Browser tests

Playwright tests that drive the real staff console and customer portal through the real Keycloak login pages, against the local stack, and run axe-core accessibility checks (WCAG 2.1 A/AA; serious and critical violations fail the test) on each main screen.

```bash
docker compose --profile app up -d --build      # whole stack; wait for ClamAV to be healthy
cd e2e && npm install && npx playwright install chromium
npx playwright test
```

`global-setup.ts` prepares the stack for the tests (dev-only: enables password grants on the development clients, configures the email and portal channels, adds the case agent to the support queue and an assignment rule). It writes to the running stack's database, so use a development stack, never a shared environment.

Covered: customer signs in, raises a complaint and replies; supervisor creates, progresses and resolves a ticket (root cause required) and views the dashboard with trends; administrator sees every configuration screen; auditor runs a full chain verification and searches the audit trail.
