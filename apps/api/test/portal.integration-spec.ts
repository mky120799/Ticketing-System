import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { DeliveryWorker } from '../src/email/delivery.worker.js';
import { AttachmentScanWorker } from '../src/tickets/attachment-scan.worker.js';
import { uploadLinkToken } from '../src/tickets/upload-link-token.js';

const run = process.env.RUN_DB_INTEGRATION === '1';
(run ? describe : describe.skip)('customer portal', () => {
  let app: NestFastifyApplication; let pool: Pool; let server: Server; let privateKey: KeyLike; let base: string;
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => { if (req.url === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; } res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x');
    base = `http://127.0.0.1:${a.port}`;
    Object.assign(process.env, { OIDC_ISSUER: `${base}/realms/staff`, OIDC_AUDIENCE: 'bank-case-api', OIDC_JWKS_URI: `${base}/jwks`, PORTAL_OIDC_ISSUER: `${base}/realms/customers`, PORTAL_OIDC_AUDIENCE: 'bank-case-portal-api', PORTAL_OIDC_JWKS_URI: `${base}/jwks`, PORTAL_MAX_REQUESTS_PER_HOUR: '3' });
    Object.assign(process.env, { UPLOAD_LINK_SECRET: 'test-upload-link-secret-0123456789', PORTAL_PUBLIC_URL: 'http://localhost:5174' });
    if (process.env.STORAGE_TEST === '1') Object.assign(process.env, { OBJECT_STORAGE_ENDPOINT: 'http://localhost:8333', OBJECT_STORAGE_BUCKET: 'bank-case-attachments', OBJECT_STORAGE_FORCE_PATH_STYLE: 'true', OBJECT_STORAGE_CREATE_BUCKET: 'true', OBJECT_STORAGE_ACCESS_KEY_ID: 'local-s3', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-s3-change-me', CLAMAV_HOST: 'localhost', CLAMAV_PORT: '3310' });
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

  // Needs the object store and ClamAV: STORAGE_TEST=1 docker compose --profile app up -d
  (process.env.STORAGE_TEST === '1' ? it : it.skip)('lets a customer add documents that are scanned before anyone can open them', async () => {
    const erin = await customer('44444444-aaaa-bbbb-cccc-000000000004'); const mallory = await customer('55555555-aaaa-bbbb-cccc-000000000005'); const sup = await staff(['supervisor'], 'doc-sup'); const admin = await staff(['administrator'], 'doc-admin');
    await app.inject({ method: 'PUT', url: '/v1/configuration/intake-channels/portal', headers: h(admin), payload: { defaultCategory: 'service-request', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true } });
    const id = (await app.inject({ method: 'POST', url: '/v1/portal/requests', headers: h(erin, { 'idempotency-key': 'doc1' }), payload: { kind: 'request', subject: 'Proof of identity', description: 'I need to send my identity document.' } })).json().id as string;
    const intent = (token: string, body: object) => app.inject({ method: 'POST', url: `/v1/portal/requests/${id}/attachments`, headers: h(token), payload: body });
    const send = async (content: string) => {
      const bytes = Buffer.from(content); const created = await intent(erin, { filename: 'id.txt', contentType: 'text/plain', sizeBytes: bytes.length }); expect(created.statusCode).toBe(201);
      expect((await fetch(created.json().uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes })).status).toBe(200);
      expect((await app.inject({ method: 'POST', url: `/v1/portal/requests/${id}/attachments/${created.json().id}/complete`, headers: h(erin), payload: { checksumSha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length } })).statusCode).toBe(201);
      return created.json().id as string;
    };
    // only the owner, only allowed types and sizes
    expect((await intent(mallory, { filename: 'x.txt', contentType: 'text/plain', sizeBytes: 10 })).statusCode).toBe(404);
    expect((await intent(erin, { filename: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 10 })).statusCode).toBe(400);
    expect((await intent(erin, { filename: 'big.pdf', contentType: 'application/pdf', sizeBytes: 20 * 1024 * 1024 })).statusCode).toBe(413);

    const clean = await send('A harmless document.');
    const listed = () => app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(erin) }).then((r) => r.json().attachments as Array<{ id: string; status: string }>);
    expect(await listed()).toEqual([expect.objectContaining({ id: clean, status: 'being_checked' })]);
    expect((await pool.query("SELECT 1 FROM ticket_notes WHERE ticket_id=$1 AND author_id='customer:portal' AND body LIKE 'The customer attached a document%'", [id])).rowCount).toBe(1); // staff are told like for any customer message
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${id}/attachments/${clean}/download`, headers: h(sup) })).statusCode).toBe(409); // not before the scan

    const virus = await send('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    expect(await app.get(AttachmentScanWorker).runOnce()).toBeGreaterThanOrEqual(2);
    const after = await listed(); expect(after.find((a) => a.id === clean)?.status).toBe('received'); expect(after.find((a) => a.id === virus)?.status).toBe('not_accepted');
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${id}/attachments/${clean}/download`, headers: h(sup) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${id}/attachments/${virus}/download`, headers: h(sup) })).statusCode).toBe(409);
  }, 60_000);

  (process.env.STORAGE_TEST === '1' ? it : it.skip)('lets staff send a secure upload link to a caller who has no portal account', async () => {
    const sup = await staff(['supervisor'], 'link-sup'); const caller = 'mailto:caller@example.com';
    const created = await app.inject({ method: 'POST', url: '/v1/tickets', headers: h(sup, { 'idempotency-key': `link-${Date.now()}` }), payload: { category: 'service-request', priority: 'normal', sensitivity: 'standard', queue: 'customer-support', branchCode: 'BLR-01', department: 'operations', legalEntity: 'BANK-IN', country: 'IN', subject: 'Caller needs to send ID', description: 'Phone call: documents needed.', references: [{ referenceType: 'customer', sourceSystem: 'CRM', opaqueReference: 'CUST-LINK-0001' }] } });
    expect(created.statusCode).toBe(201); const id = created.json().id as string;
    const request = (payload: object) => app.inject({ method: 'POST', url: `/v1/tickets/${id}/communications`, headers: h(sup), payload });
    expect((await request({ channel: 'portal', templateKey: 'document_request_email', recipientReference: caller })).statusCode).toBe(409); // a link is never sent through the portal
    const sent = await request({ channel: 'email', templateKey: 'document_request_email', recipientReference: caller }); expect(sent.statusCode).toBe(201); expect(sent.json().status).toBe('queued');
    const link = (await pool.query('SELECT id,max_files FROM upload_links WHERE ticket_id=$1', [id])).rows[0]; expect(link.max_files).toBe(5);
    const token = uploadLinkToken(link.id as string);
    const call = (method: 'GET' | 'POST', url: string, payload?: object, t: string | null = token) => app.inject({ method, url: `/v1/upload${url}`, headers: { 'content-type': 'application/json', ...(t ? { 'x-upload-token': t } : {}) }, ...(payload ? { payload } : {}) });

    // forged, edited or missing tokens all get the same answer
    for (const bad of [null, 'nonsense', `${link.id}.AAAA`, `${link.id.replace(/.$/, '0')}.${token.split('.')[1]}`]) expect((await call('GET', '/status', undefined, bad)).statusCode).toBe(404);
    expect((await call('GET', '/status')).json()).toMatchObject({ reference: expect.stringMatching(/^CASE-/), remaining: 5, documents: [] });

    // an upload works, is scanned, and the link only ever allows sending
    const bytes = Buffer.from('Caller document.');
    const intent = await call('POST', '/attachments', { filename: 'passport.txt', contentType: 'text/plain', sizeBytes: bytes.length }); expect(intent.statusCode).toBe(201);
    expect((await fetch(intent.json().uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes })).status).toBe(200);
    expect((await call('POST', `/attachments/${intent.json().id}/complete`, { checksumSha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length })).statusCode).toBe(201);
    expect((await call('GET', '/status')).json()).toMatchObject({ remaining: 4, documents: [expect.objectContaining({ filename: 'passport.txt', status: 'being_checked' })] });
    expect((await pool.query("SELECT uploaded_by FROM attachments WHERE id=$1", [intent.json().id])).rows[0].uploaded_by).toBe('customer:link');
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${id}/attachments/${intent.json().id}/download`, headers: h(sup) })).statusCode).toBe(409); // not before the scan
    await app.get(AttachmentScanWorker).runOnce();
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${id}/attachments/${intent.json().id}/download`, headers: h(sup) })).statusCode).toBe(200);

    // limits: the link's file count, then withdrawal by staff
    await pool.query('UPDATE upload_links SET max_files=1 WHERE id=$1', [link.id]);
    expect((await call('POST', '/attachments', { filename: 'again.txt', contentType: 'text/plain', sizeBytes: 5 })).statusCode).toBe(409);
    await pool.query('UPDATE upload_links SET max_files=5 WHERE id=$1', [link.id]);
    expect((await app.inject({ method: 'DELETE', url: `/v1/tickets/${id}/upload-links/${link.id}`, headers: { authorization: `Bearer ${sup}` } })).statusCode).toBe(200);
    expect((await call('GET', '/status')).statusCode).toBe(404);
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
    // resolving queued a notice for the customer on its own; it waits for a supervisor, then reaches the customer's portal
    const notice = (await pool.query("SELECT c.status,a.id AS approval_id FROM ticket_communications c JOIN approval_requests a ON a.communication_id=c.id WHERE c.ticket_id=$1 AND c.template_key='resolution_notice_portal'", [id])).rows;
    expect(notice).toHaveLength(1); expect(notice[0].status).toBe('pending_approval');
    expect((await app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(dana) })).json().updates.some((u: { title?: string }) => u.title?.includes('has been resolved'))).toBe(false); // not before approval
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${id}/approvals/${notice[0].approval_id}/decision`, headers: h(sup), payload: { decision: 'approved' } })).statusCode).toBe(201);
    await app.get(DeliveryWorker).runOnce();
    expect((await app.inject({ method: 'GET', url: `/v1/portal/requests/${id}`, headers: h(dana) })).json().updates.some((u: { title?: string }) => u.title?.includes('has been resolved'))).toBe(true);
    // it is tracked by the timer like a complaint but is not listed in the complaints register
    await pool.query("UPDATE tickets SET acknowledge_due_at = now() - interval '1 hour', resolved_at = NULL, status='in_progress' WHERE id=$1", [id]);
    await app.get(DeliveryWorker).runOnce();
  });
});
