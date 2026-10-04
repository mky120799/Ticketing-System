// Repeatable load test against a running stack (docker compose --profile app up -d). Prints requests/s and latency percentiles.
//   node run.mjs                     (defaults: 20 s per scenario, 30 connections)
//   DURATION=60 CONNECTIONS=100 node run.mjs
// Numbers from a laptop running every dependency in containers are a baseline for comparison, not a capacity promise.
import autocannon from 'autocannon';

const KC = process.env.KEYCLOAK ?? 'http://localhost:8080'; const API = process.env.API ?? 'http://localhost:3000/v1';
const duration = Number(process.env.DURATION ?? 20); const connections = Number(process.env.CONNECTIONS ?? 30);

async function staffToken() {
  const r = await fetch(`${KC}/realms/bank-case-dev/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'bank-case-web', username: 'local-supervisor', password: 'local-dev-only-change-me' }) });
  return (await r.json()).access_token;
}
async function gatewayToken() {
  const r = await fetch(`${KC}/realms/bank-case-dev/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'intake-gateway', client_secret: 'local-dev-only-intake-secret' }) });
  return (await r.json()).access_token;
}
const run = (options) => new Promise((resolve, reject) => autocannon({ duration, connections, ...options }, (error, result) => (error ? reject(error) : resolve(result))));
const row = (name, r) => ({ scenario: name, 'req/s': Math.round(r.requests.average), 'p50 ms': r.latency.p50, 'p97.5 ms': r.latency.p97_5, 'p99 ms': r.latency.p99, 'max ms': r.latency.max, '2xx': r.statusCodeStats && Object.entries(r.statusCodeStats).filter(([c]) => c.startsWith('2')).reduce((n, [, v]) => n + v.count, 0), 'non-2xx': r.non2xx, errors: r.errors, timeouts: r.timeouts });

const results = [];
results.push(row('health (database ping)', await run({ url: `${API}/health/ready` })));
const staff = await staffToken();
results.push(row('list tickets (authenticated, audited)', await run({ url: `${API}/tickets?limit=50`, headers: { authorization: `Bearer ${staff}` } })));
results.push(row('dashboard summary (aggregates)', await run({ url: `${API}/dashboard/summary`, headers: { authorization: `Bearer ${staff}` }, connections: Math.min(connections, 10) })));
const gateway = await gatewayToken(); let n = 0; const stamp = Date.now();
results.push(row('create ticket via intake (write path: SLA, assignment, audit, outbox)', await run({ url: API.replace(/\/v1$/, ''), connections: Math.min(connections, 20),
  requests: [{ method: 'POST', path: '/v1/intake/email', headers: { authorization: `Bearer ${gateway}`, 'content-type': 'application/json' },
    setupRequest: (request) => { n++; request.body = JSON.stringify({ messageId: `<load-${stamp}-${n}@x>`, senderReference: `CUST-REF-L${String(n).padStart(6, '0')}`, subject: 'Load test', body: 'load test body' }); return request; } }] })));
console.table(results);
