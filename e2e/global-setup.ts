// Prepares the local stack for the browser tests: dev-only password grants (to get admin tokens), then the channel, queue member and rule the tests rely on.
const KC = 'http://localhost:8080'; const API = 'http://localhost:3000/v1';
async function adminToken(): Promise<string> {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'local-admin', password: 'local-admin-change-me' }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
async function enableDirectGrants(admin: string, realm: string, clientId: string): Promise<void> {
  const clients = (await (await fetch(`${KC}/admin/realms/${realm}/clients?clientId=${clientId}`, { headers: { Authorization: `Bearer ${admin}` } })).json()) as { id: string }[];
  await fetch(`${KC}/admin/realms/${realm}/clients/${clients[0].id}`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, directAccessGrantsEnabled: true }) });
}
async function token(realm: string, client: string, user: string): Promise<string> {
  const r = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: client, username: user, password: 'local-dev-only-change-me' }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
export default async function globalSetup(): Promise<void> {
  const admin = await adminToken();
  await enableDirectGrants(admin, 'bank-case-dev', 'bank-case-web');
  const adminApi = await token('bank-case-dev', 'bank-case-web', 'local-admin'); const agentApi = await token('bank-case-dev', 'bank-case-web', 'local-case-agent');
  const put = (path: string, body: unknown) => fetch(`${API}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${adminApi}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const me = (await (await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${agentApi}` } })).json()) as { subject: string };
  for (const channel of ['portal', 'email']) await put(`/configuration/intake-channels/${channel}`, { defaultCategory: 'service-request', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true });
  await put(`/configuration/queues/customer-support/members/${me.subject}`, { active: true });
  await put('/configuration/assignment-rules/e2e-default', { queue: 'customer-support', strategy: 'least_loaded', sortOrder: 100, active: true });
}
