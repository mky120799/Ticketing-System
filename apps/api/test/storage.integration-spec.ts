import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { ReportExportService } from '../src/operations/report-export.service.js';
import { AttachmentStorageService } from '../src/storage/attachment-storage.service.js';
import { AttachmentScanWorker } from '../src/tickets/attachment-scan.worker.js';

// Needs the object store and ClamAV: STORAGE_TEST=1 docker compose --profile storage up -d
const run = process.env.STORAGE_TEST === '1';
(run ? describe : describe.skip)('attachments with real object storage and malware scanning', () => {
  let app: NestFastifyApplication; let pool: Pool; let server: Server; let privateKey: KeyLike; let issuer: string;
  beforeAll(async () => {
    Object.assign(process.env, { OBJECT_STORAGE_ENDPOINT: 'http://localhost:8333', OBJECT_STORAGE_BUCKET: 'bank-case-attachments', OBJECT_STORAGE_FORCE_PATH_STYLE: 'true', OBJECT_STORAGE_CREATE_BUCKET: 'true', OBJECT_STORAGE_ACCESS_KEY_ID: 'local-s3', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'local-s3-change-me', CLAMAV_HOST: 'localhost', CLAMAV_PORT: '3310' });
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => { if (req.url === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; } res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x');
    issuer = `http://127.0.0.1:${a.port}/realms/i`; process.env.OIDC_ISSUER = issuer; process.env.OIDC_AUDIENCE = 'bank-case-api'; process.env.OIDC_JWKS_URI = `http://127.0.0.1:${a.port}/jwks`;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init(); await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool?.end(); await app?.close(); await new Promise<void>((r) => server.close(() => r())); });
  const tok = (roles: string[], sub: string, ctx = true) => new SignJWT({ roles, ...(ctx ? { branch: 'BLR-01', queues: ['customer-support', 'payments'], department: 'operations', legal_entity: 'BANK-IN', country: 'IN' } : {}) }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(issuer).setAudience('bank-case-api').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const h = (t: string) => ({ authorization: `Bearer ${t}`, 'x-correlation-id': `storage-${Date.now()}`, 'content-type': 'application/json' });

  async function attach(ticketId: string, sup: string, content: string, declaredChecksum?: string) {
    const bytes = Buffer.from(content); const intent = (await app.inject({ method: 'POST', url: `/v1/tickets/${ticketId}/attachments`, headers: h(sup), payload: { filename: 'file.txt', contentType: 'text/plain', sizeBytes: bytes.length, classification: 'confidential' } })).json();
    expect(intent.storageConfigured).toBe(true);
    const upload = await fetch(intent.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: bytes }); expect(upload.status).toBe(200);
    const checksum = declaredChecksum ?? createHash('sha256').update(bytes).digest('hex');
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${ticketId}/attachments/${intent.id}/complete`, headers: h(sup), payload: { checksumSha256: checksum, sizeBytes: bytes.length } })).statusCode).toBe(201);
    return intent.id as string;
  }

  it('releases clean files, blocks the EICAR test virus and refuses a checksum mismatch', async () => {
    const sup = await tok(['supervisor'], 'storage-sup'); const gw = await tok(['intake-gateway'], 'storage-gw', false);
    expect((await app.inject({ method: 'PUT', url: '/v1/configuration/intake-channels/email', headers: h(await tok(['administrator'], 'storage-admin')), payload: { defaultCategory: 'service-request', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true } })).statusCode).toBe(200);
    const ticketId = (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<st-${Date.now()}@x>`, senderReference: 'CUST-REF-STORE1', subject: 'Attachments', body: 'b' } })).json().ticketId as string;
    const clean = await attach(ticketId, sup, 'a perfectly ordinary document');
    const eicar = await attach(ticketId, sup, 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const tampered = await attach(ticketId, sup, 'content whose checksum is wrong', 'a'.repeat(64));
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}/attachments/${clean}/download`, headers: h(sup) })).statusCode).toBe(409); // not scanned yet
    expect(await app.get(AttachmentScanWorker).runOnce()).toBe(3);
    const status = async (id: string) => (await pool.query('SELECT malware_status FROM attachments WHERE id=$1', [id])).rows[0].malware_status;
    expect(await status(clean)).toBe('clean'); expect(await status(eicar)).toBe('malicious'); expect(await status(tampered)).toBe('scan_error');
    const download = await app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}/attachments/${clean}/download`, headers: h(sup) }); expect(download.statusCode).toBe(200);
    expect(await (await fetch(download.json().downloadUrl)).text()).toBe('a perfectly ordinary document');
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}/attachments/${eicar}/download`, headers: h(sup) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}/attachments/${tampered}/download`, headers: h(sup) })).statusCode).toBe(409);
  }, 60_000);

  it('exports scheduled reports to object storage', async () => {
    const sup = await tok(['supervisor'], 'rep-sup'); const gw = await tok(['intake-gateway'], 'rep-gw', false);
    await app.inject({ method: 'PUT', url: '/v1/configuration/intake-channels/portal', headers: h(await tok(['administrator'], 'rep-admin')), payload: { defaultCategory: 'complaint', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true } });
    await app.inject({ method: 'POST', url: '/v1/intake/portal', headers: h(gw), payload: { messageId: `<rep-${Date.now()}@x>`, senderReference: 'CUST-REF-REP001', subject: 'Report me', body: 'free text that must not leak' } });
    void sup;
    const { files } = await app.get(ReportExportService).runOnce(); expect(files).toBeGreaterThanOrEqual(2);
    const day = new Date().toISOString().slice(0, 10); const stream = await app.get(AttachmentStorageService).getObjectStream(`reports/BANK-IN-IN/${day}/complaints-register.csv`);
    let text = ''; for await (const chunk of stream!) text += Buffer.from(chunk).toString('utf8');
    expect(text.split('\n')[0]).toContain('regulatory_status'); expect(text).not.toContain('free text that must not leak'); expect(text.split('\n').length).toBeGreaterThan(1);
  }, 60_000);
});
