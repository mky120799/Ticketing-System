// Dev-only: pretends to be an email adapter. Gets a service token from the local Keycloak realm and posts one message.
// Usage: node scripts/simulate-intake.mjs [channel] ["subject"] ["body"]   (env: API_URL, OIDC_TOKEN_URL, INTAKE_CLIENT_SECRET)
const [channel = 'email', subject = 'Card declined abroad', body = 'My card was declined at a shop while travelling. Please check.'] = process.argv.slice(2);
const api = process.env.API_URL ?? 'http://localhost:3000/v1';
const tokenUrl = process.env.OIDC_TOKEN_URL ?? 'http://localhost:8080/realms/bank-case-dev/protocol/openid-connect/token';
const token = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'intake-gateway', client_secret: process.env.INTAKE_CLIENT_SECRET ?? 'local-dev-only-intake-secret' }) }).then((r) => r.json());
if (!token.access_token) { console.error('Could not get a service token:', token); process.exit(1); }
const messageId = process.env.MESSAGE_ID ?? `<sim-${Date.now()}@mail.example>`;
const response = await fetch(`${api}/intake/${channel}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}` }, body: JSON.stringify({ messageId, senderReference: 'CUST-REF-00042', subject, body }) });
console.log(response.status, await response.text());
