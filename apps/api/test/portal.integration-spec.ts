import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { DeliveryWorker } from '../src/email/delivery.worker.js';

const run = process.env.RUN_DB_INTEGRATION === '1';
(run ? describe : describe.skip)('customer portal', () => {
  let app: NestFastifyApplication; let pool: Pool; let server: Server; let privateKey: KeyLike; let base: string;
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => { if (req.url === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; } res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x');
    base = `http://127.0.0.1:${a.port}`;
    Object.assign(process.env, { OIDC_ISSUER: `${base}/realms/staff`, OIDC_AUDIENCE: 'bank-case-api', OIDC_JWKS_URI: `${base}/jwks`, PORTAL_OIDC_ISSUER: `${base}/realms/customers`, PORTAL_OIDC_AUDIENCE: 'bank-case-portal-api', PORTAL_OIDC_JWKS_URI: `${base}/jwks`, PORTAL_MAX_REQUESTS_PER_HOUR: '3' });
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init(); await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool?.end(); await app?.close(); await new Promise<void>((r) => server.close(() => r())); });
  const customer = (sub: string, issuer = `${base}/realms/customers`, audience = 'bank-case-portal-api') => new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(issuer).setAudience(audience).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const staff = (roles: string[], sub: string) => new SignJWT({ roles, branch: 'BLR-01', queues: ['customer-support', 'payments'], department: 'operations', legal_entity: 'BANK-IN', country: 'IN' }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(`${base}/realms/staff`).setAudience('bank-case-api').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const h = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json', ...extra });

  it('lets customers raise and follow only their own requests, and keeps staff and customer identities apart', async () => {
    const admin = await staff(['administrator'], 'portal-admin'); const sup = await staff(['supervisor'], 'portal-sup');
    expect((await app.inject({ method: 'PUT', url: '/v1/configuration/intake-channels/portal', headers: h(admin), payload: { defaultCategory: 'service-request', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true } })).statusCode).toBe(200);
    const alice = await customer('11111111-aaaa-bbbb-cccc-000000000001'); const bob = await customer('22222222-aaaa-bbbb-cccc-000000000002');

    // separation of identities
    expect((await app.inject({ method: 'GET', url: '/v1/portal/requests' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(await staff(['supervisor'], 'x')) })).statusCode).toBe(401); // a staff token is not a customer token
    expect((await app.inject({ method: 'GET', url: '/v1/tickets', headers: h(alice) })).statusCode).toBe(401); // a customer token is not a staff token
    expect((await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(await customer('z', `${base}/realms/customers`, 'someone-else'))})).statusCode).toBe(401);

    // raise a complaint, idempotently
    const create = (t: string, kind: string, subject: string, key?: string) => app.inject({ method: 'POST', url: '/v1/portal/requests', headers: h(t, key ? { 'idempotency-key': key } : {}), payload: { kind, subject, description: 'Details of my problem.' } });
    const first = await create(alice, 'complaint', 'Fee charged in error', 'k1'); expect(first.statusCode).toBe(201); const id = first.json().id as string; expect(first.json().reference).toMatch(/^CASE-[0-9A-F]{8}$/);
    expect((await create(alice, 'complaint', 'Fee charged in error', 'k1')).json()).toMatchObject({ id, duplicate: true });
    const row = (await pool.query('SELECT is_complaint,source_channel,regulatory_status FROM tickets WHERE id=$1', [id])).rows[0]; expect(row).toMatchObject({ is_complaint: true, source_channel: 'portal', regulatory_status: 'on_track' });

    // ownership
    expect((await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(bob) })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(bob) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/portal/requests/${id}/messages`, headers: h(bob), payload: { body: 'hijack' } })).statusCode).toBe(404);
    const mine = (await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(alice) })).json(); expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, subject: 'Fee charged in error', status: 'received', isComplaint: true, complaint: { acknowledged: false } });
    expect(JSON.stringify(mine)).not.toMatch(/queue|assigned|sla|sensitivity|internal/i);

    // staff talk to the customer; internal notes stay internal; portal messages reach the customer as updates
    await app.inject({ method: 'POST', url: `/v1/tickets/${id}/notes`, headers: h(sup), payload: { visibility: 'internal', body: 'secret staff view' } });
    await app.inject({ method: 'POST', url: `/v1/tickets/${id}/notes`, headers: h(sup), payload: { visibility: 'customer', body: 'We are looking into this.' } });
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${id}/communications`, headers: h(sup), payload: { channel: 'portal', templateKey: 'portal_update', recipientReference: 'ignored-by-server' } })).statusCode).toBe(201);
    expect(await app.get(DeliveryWorker).runOnce()).toBeGreaterThanOrEqual(1);
    const detail = (await app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(alice) })).json();
    expect(JSON.stringify(detail)).not.toContain('secret staff view');
    expect(detail.updates.map((u: { text: string }) => u.text).join(' ')).toContain('We are looking into this.'); expect(detail.updates.some((u: { title?: string }) => u.title?.includes('Update on your request'))).toBe(true);
    expect(detail.complaint.acknowledged).toBe(true); // a customer-visible response counts as the acknowledgement

    // reply: stored as the customer's own words; does not count as a staff response
    await pool.query("UPDATE tickets SET status='pending_customer' WHERE id=$1", [id]);
    expect((await app.inject({ method: 'POST', url: `/v1/portal/requests/${id}/messages`, headers: h(alice), payload: { body: 'Here is more information.' } })).statusCode).toBe(201);
    expect((await pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status).toBe('in_progress');
    expect((await app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(alice) })).json().updates.some((u: { from: string; text: string }) => u.from === 'you' && u.text === 'Here is more information.')).toBe(true);

    // limits and validation
    expect((await create(alice, 'request', 'Second', 'k2')).statusCode).toBe(201); expect((await create(alice, 'request', 'Third', 'k3')).statusCode).toBe(201);
    expect((await create(alice, 'request', 'Fourth', 'k4')).statusCode).toBe(429);
    expect((await create(bob, 'nonsense', 'Bad kind')).statusCode).toBe(400);
    // tickets staff created by other means never appear in a customer's list
    expect((await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(bob) })).json()).toEqual([]);
  }, 60_000);

  it('handles a request to correct personal information with its own clock and outcomes', async () => {
    const sup = await staff(['supervisor'], 'priv-sup'); const dana = await customer('33333333-aaaa-bbbb-cccc-000000000003');
    const created = await app.inject({ method: 'POST', url: '/v1/portal/requests', headers: h(dana, { 'idempotency-key': 'c1' }), payload: { kind: 'correction', subject: 'Wrong address on file', description: 'My address is out of date.' } });
    expect(created.statusCode).toBe(201); const id = created.json().id as string;
    const row = (await pool.query('SELECT is_complaint,case_kind,regulatory_profile,acknowledge_due_at,final_response_due_at,created_at FROM tickets WHERE id=$1', [id])).rows[0];
    expect(row).toMatchObject({ is_complaint: false, case_kind: 'privacy_request', regulatory_profile: 'au-app13-correction' }); expect(Math.round((row.final_response_due_at - row.created_at) / 86_400_000)).toBe(30);
    const listed = (await app.inject({ method: 'GET', url: '/v1/portal/requests', headers: h(dana) })).json();
    expect(listed[0]).toMatchObject({ id, kind: 'correction', complaint: { acknowledged: false } });
    const move = (payload: object) => app.inject({ method: 'POST', url: `/v1/tickets/${id}/status`, headers: h(sup), payload: { reason: 'privacy test', ...payload } });
    for (const step of ['triage', 'assigned', 'in_progress']) expect((await move({ toStatus: step })).statusCode).toBe(201);
    expect((await move({ toStatus: 'resolved', rootCause: 'process_gap' })).statusCode).toBe(400);                                        // an outcome is required
    expect((await move({ toStatus: 'resolved', rootCause: 'process_gap', idrOutcome: 'upheld' })).statusCode).toBe(400);                  // a complaint outcome does not fit a correction request
    expect((await move({ toStatus: 'resolved', rootCause: 'process_gap', idrOutcome: 'corrected' })).statusCode).toBe(201);
    // it is tracked by the timer like a complaint but is not listed in the complaints register
    await pool.query("UPDATE tickets SET acknowledge_due_at = now() - interval '1 hour', resolved_at = NULL, status='in_progress' WHERE id=$1", [id]);
    await app.get(DeliveryWorker).runOnce();
  });
});
