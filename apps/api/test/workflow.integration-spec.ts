import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { LiveEventsService, type LiveFrame } from '../src/live/live-events.service.js';
import { AuditIntegrityService } from '../src/audit/audit-integrity.service.js';
import { archiveAuditEvents } from '../src/audit/audit-archive.js';
import { RetentionService } from '../src/retention/retention.service.js';
import { WorkflowScheduler } from '../src/workflow/workflow-scheduler.js';

/** Exercises routing, escalation, intake, live events and the outbox together. Run against a disposable, otherwise empty database. */
describe('routing, escalation, intake and live events', () => {
  let app: NestFastifyApplication; let pool: Pool; let server: Server; let privateKey: KeyLike; let issuer: string;
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => { if (req.url === '/jwks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; } res.statusCode = 404; res.end(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x');
    issuer = `http://127.0.0.1:${a.port}/realms/i`; process.env.OIDC_ISSUER = issuer; process.env.OIDC_AUDIENCE = 'bank-case-api'; process.env.OIDC_JWKS_URI = `http://127.0.0.1:${a.port}/jwks`;
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication<NestFastifyApplication>(new FastifyAdapter()); app.setGlobalPrefix('v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.init(); await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool?.query("UPDATE integration_outbox SET status='published' WHERE status IN ('pending','retry','in_flight')"); await pool?.query("DELETE FROM escalation_rules WHERE rule_key LIKE 'smoke-%'"); await pool?.query("DELETE FROM assignment_rules WHERE rule_key LIKE 'smoke-%'"); await pool?.query("DELETE FROM queue_members WHERE user_id LIKE 'smoke-%'"); await pool?.end(); await app?.close(); await new Promise<void>((r) => server.close(() => r())); });
  const tok = (roles: string[], sub: string, ctx = true) => new SignJWT({ roles, ...(ctx ? { branch: 'BLR-01', queues: ['customer-support', 'payments'], department: 'operations', legal_entity: 'BANK-IN', country: 'IN' } : {}) }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(issuer).setAudience('bank-case-api').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const h = (t: string) => ({ authorization: `Bearer ${t}`, 'x-correlation-id': `smoke-${Date.now()}`, 'content-type': 'application/json' });

  it('assigns, escalates, de-duplicates intake and pushes only authorized live events', async () => {
    const admin = await tok(['administrator'], 'smoke-admin'); const sup = await tok(['supervisor'], 'smoke-sup'); const gw = await tok(['intake-gateway'], 'smoke-gw', false);
    const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers: h(admin), payload: payload as object });
    expect((await put('/v1/configuration/queues/customer-support/members/smoke-agent-1', { active: true })).statusCode).toBe(200);
    expect((await put('/v1/configuration/assignment-rules/smoke-rule', { queue: 'customer-support', strategy: 'least_loaded', sortOrder: 100, active: true })).statusCode).toBe(200);
    expect((await put('/v1/configuration/escalation-rules/smoke-esc', { queue: 'customer-support', trigger: 'first_response_overdue', escalateToQueue: 'payments', raisePriority: true, active: true })).statusCode).toBe(200);
    expect((await put('/v1/configuration/intake-channels/email', { defaultCategory: 'complaint', defaultQueue: 'customer-support', branchCode: 'DIGITAL', defaultPriority: 'normal', active: true })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/configuration/intake-channels', headers: h(admin) })).json().length).toBeGreaterThanOrEqual(1);
    // a self-escalation must be rejected
    expect((await put('/v1/configuration/escalation-rules/bad', { queue: 'payments', trigger: 'breached', escalateToQueue: 'payments', raisePriority: false, active: true })).statusCode).toBe(409);

    const frames: LiveFrame[] = []; const supCtx = { subject: 'smoke-sup', roles: ['supervisor' as const], branch: 'BLR-01', queues: ['customer-support', 'payments'], department: 'operations', legalEntity: 'BANK-IN', country: 'IN' };
    const outsider = { ...supCtx, subject: 'smoke-out', queues: ['fraud'] }; const outFrames: LiveFrame[] = [];
    const live = app.get(LiveEventsService); live.subscribe(supCtx, (f) => frames.push(f)); live.subscribe(outsider, (f) => outFrames.push(f)); await new Promise((r) => setTimeout(r, 800));

    const msg = { messageId: `<smoke-${Date.now()}@x>`, senderReference: 'CUST-REF-00042', subject: 'Smoke intake', body: 'hello' };
    const first = await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: msg }); expect(first.statusCode).toBe(200); const { ticketId, duplicate } = first.json(); expect(duplicate).toBe(false);
    const again = await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: msg }); expect(again.json()).toMatchObject({ ticketId, duplicate: true });
    expect((await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { ...msg, body: 'changed' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/v1/tickets', headers: h(gw) })).statusCode).toBe(403);
    let row = (await pool.query('SELECT status,assigned_to,source_channel,queue,priority FROM tickets WHERE id=$1', [ticketId])).rows[0];
    expect(row).toMatchObject({ status: 'assigned', assigned_to: 'smoke-agent-1', source_channel: 'email', queue: 'customer-support' });

    await pool.query("UPDATE tickets SET first_response_due_at = now() - interval '1 hour' WHERE id=$1", [ticketId]);
    const tick = await app.get(WorkflowScheduler).tick(); expect(tick?.escalated).toBe(1); expect(tick?.slaUpdated).toBeGreaterThanOrEqual(1);
    row = (await pool.query('SELECT status,assigned_to,queue,priority,sla_status FROM tickets WHERE id=$1', [ticketId])).rows[0];
    expect(row).toMatchObject({ status: 'escalated', assigned_to: null, queue: 'payments', priority: 'high', sla_status: 'first_response_overdue' });
    expect((await app.get(WorkflowScheduler).tick())?.escalated).toBe(0);

    await new Promise((r) => setTimeout(r, 500));
    const types = frames.filter((f) => f.event === 'ticket').map((f) => (f as { data: { type: string } }).data.type);
    expect(types).toEqual(expect.arrayContaining(['ticket.created', 'ticket.escalated', 'ticket.sla_changed']));
    expect(outFrames).toHaveLength(0);

    const detail = await app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}`, headers: h(sup) }); expect(detail.statusCode).toBe(200);
    expect(detail.json().history.map((x: { changedBy: string }) => x.changedBy)).toEqual(['system:assignment-rules', 'system:escalation']);

    const published: string[] = []; await app.get(OutboxService).processBatch({ publish: async (e) => { published.push(e.eventType); } }, 100);
    expect(published).toEqual(expect.arrayContaining(['ticket.created', 'ticket.assigned', 'ticket.escalated', 'ticket.sla_status_changed']));
    expect(await app.get(OutboxService).releaseStale(0)).toBe(0);
  });

  it('serves a real SSE stream', async () => {
    await app.listen(0, '127.0.0.1'); const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const sup = await tok(['supervisor'], 'smoke-sse'); const gw = await tok(['intake-gateway'], 'smoke-gw2', false);
    expect((await fetch(`${url}/v1/events/stream`)).status).toBe(401);
    expect((await fetch(`${url}/v1/events/stream`, { headers: { authorization: `Bearer ${gw}` } })).status).toBe(403);
    const controller = new AbortController(); const response = await fetch(`${url}/v1/events/stream`, { headers: { authorization: `Bearer ${sup}`, origin: 'http://localhost:5173' }, signal: controller.signal });
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('text/event-stream');
    await new Promise((r) => setTimeout(r, 500));
    await fetch(`${url}/v1/intake/email`, { method: 'POST', headers: { authorization: `Bearer ${gw}`, 'content-type': 'application/json' }, body: JSON.stringify({ messageId: `<sse-${Date.now()}@x>`, senderReference: 'CUST-REF-00099', subject: 'SSE', body: 'b' }) });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader(); let text = '';
    const deadline = Date.now() + 5000; while (!text.includes('event: ticket') && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; text += value; }
    controller.abort();
    expect(text).toContain('event: ticket'); expect(text).toContain('ticket.created'); expect(text).not.toContain('CUST-REF');
  });

  it('requires a root cause to resolve, records first response, and reports it', async () => {
    const sup = await tok(['supervisor'], 'smoke-sup2'); const gw = await tok(['intake-gateway'], 'smoke-gw3', false);
    const created = await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<res-${Date.now()}@x>`, senderReference: 'CUST-REF-00123', subject: 'Resolve me', body: 'b' } });
    const id = created.json().ticketId as string;
    const move = (toStatus: string, extra: object = {}) => app.inject({ method: 'POST', url: `/v1/tickets/${id}/status`, headers: h(sup), payload: { toStatus, reason: 'smoke', ...extra } });
    expect((await move('in_progress')).statusCode).toBe(201);
    expect((await move('resolved')).statusCode).toBe(400);
    expect((await move('resolved', { rootCause: 'bogus' })).statusCode).toBe(400);
    expect((await move('resolved', { rootCause: 'process_gap', idrOutcome: 'upheld' })).statusCode).toBe(201);
    const row = (await pool.query('SELECT resolved_at,first_responded_at,root_cause FROM tickets WHERE id=$1', [id])).rows[0];
    expect(row.root_cause).toBe('process_gap'); expect(row.resolved_at).not.toBeNull(); expect(row.first_responded_at).not.toBeNull();
    await app.get(WorkflowScheduler).tick();
    expect((await pool.query('SELECT sla_status FROM tickets WHERE id=$1', [id])).rows[0].sla_status).toBe('met');
    const dash = await app.inject({ method: 'GET', url: '/v1/dashboard/summary', headers: h(sup) }); expect(dash.statusCode).toBe(200);
    expect(dash.json().last30Days.rootCauses).toEqual(expect.arrayContaining([{ cause: 'process_gap', count: expect.any(Number) }]));
    expect((await move('reopened')).statusCode).toBe(201);
    expect((await pool.query('SELECT resolved_at,root_cause FROM tickets WHERE id=$1', [id])).rows[0]).toEqual({ resolved_at: null, root_cause: null });
  });

  it('runs the complaint clock, blocks tipping-off communications, and exports the register', async () => {
    const gw = await tok(['intake-gateway'], 'smoke-gw4', false); const sup2 = await tok(['supervisor'], 'smoke-sup3');
    const intake = (category: string) => app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<c-${category}-${Date.now()}@x>`, senderReference: 'CUST-REF-00777', subject: 'Complaint', body: 'I am unhappy', category } });
    const complaint = (await intake('complaint')).json().ticketId as string;
    let row = (await pool.query('SELECT is_complaint,regulatory_profile,regulatory_status,acknowledge_due_at,final_response_due_at,created_at FROM tickets WHERE id=$1', [complaint])).rows[0];
    expect(row).toMatchObject({ is_complaint: true, regulatory_profile: 'au-rg271-standard', regulatory_status: 'on_track' });
    expect(Math.round((row.final_response_due_at - row.created_at) / 86_400_000)).toBe(30);
    // resolving a complaint needs the IDR outcome as well as a root cause
    await app.inject({ method: 'POST', url: `/v1/tickets/${complaint}/status`, headers: h(sup2), payload: { toStatus: 'in_progress', reason: 'test reason' } });
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${complaint}/status`, headers: h(sup2), payload: { toStatus: 'resolved', reason: 'test reason', rootCause: 'communication' } })).statusCode).toBe(400);
    // overdue acknowledgement is detected by the timer
    await pool.query("UPDATE tickets SET acknowledge_due_at = now() - interval '1 hour' WHERE id=$1", [complaint]);
    await app.get(WorkflowScheduler).tick();
    expect((await pool.query('SELECT regulatory_status FROM tickets WHERE id=$1', [complaint])).rows[0].regulatory_status).toBe('ack_overdue');
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${complaint}/status`, headers: h(sup2), payload: { toStatus: 'resolved', reason: 'test reason', rootCause: 'communication', idrOutcome: 'upheld' } })).statusCode).toBe(201);
    await app.get(WorkflowScheduler).tick();
    expect((await pool.query('SELECT regulatory_status FROM tickets WHERE id=$1', [complaint])).rows[0].regulatory_status).toBe('met');
    // AFCA tracking + vulnerability flags
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${complaint}/afca`, headers: h(sup2), payload: { status: 'referred' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${complaint}/afca`, headers: h(sup2), payload: { status: 'referred', reference: 'AFCA-123456' } })).statusCode).toBe(201);
    const flagged = await app.inject({ method: 'PUT', url: `/v1/tickets/${complaint}/complaint`, headers: h(sup2), payload: { isComplaint: true, profileKey: 'au-rg271-standard', vulnerabilityFlag: true, reason: 'customer disclosed hardship' } });
    expect(flagged.statusCode).toBe(200); expect(flagged.json()).toMatchObject({ vulnerabilityFlag: true, afcaStatus: 'referred' });
    // a supervisor can block customer-facing activity (tipping-off); notes and communications are then refused
    const other = (await intake('complaint')).json().ticketId as string;
    expect((await app.inject({ method: 'PUT', url: `/v1/tickets/${other}/communication-block`, headers: h(sup2), payload: { blocked: true, reason: 'investigation' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${other}/notes`, headers: h(sup2), payload: { visibility: 'customer', body: 'hello' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${other}/notes`, headers: h(sup2), payload: { visibility: 'internal', body: 'fine' } })).statusCode).toBe(201);
    // register export is injection-safe CSV
    const today = new Date().toISOString().slice(0, 10);
    const csv = await app.inject({ method: 'GET', url: `/v1/reports/complaints?from=2020-01-01&to=${today}&format=csv`, headers: h(sup2) }); expect(csv.statusCode).toBe(200); expect(csv.body.split('\n')[0]).toContain('afca_reference'); expect(csv.body).not.toContain('I am unhappy');
  });

  it('enforces data-driven workflows and rejects unusable definitions', async () => {
    const admin = await tok(['administrator'], 'smoke-admin'); const sup = await tok(['supervisor'], 'smoke-sup4'); const gw = await tok(['intake-gateway'], 'smoke-gw5', false);
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/v1/configuration/workflows/smoke-flow', headers: h(admin), payload: payload as object });
    expect((await put({ label: 'bad', active: true, transitions: [{ from: 'submitted', to: 'triage' }, { from: 'triage', to: 'triage' }] })).statusCode).toBe(409);
    expect((await put({ label: 'stuck', active: true, transitions: [{ from: 'submitted', to: 'triage' }, { from: 'triage', to: 'assigned' }, { from: 'assigned', to: 'triage' }] })).statusCode).toBe(409);
    expect((await put({ label: 'ok', active: true, transitions: [{ from: 'submitted', to: 'resolved' }, { from: 'resolved', to: 'closed', allowedRoles: ['auditor'] }] })).statusCode).toBe(200);
    const created = await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<wf-${Date.now()}@x>`, senderReference: 'CUST-REF-00555', subject: 'Workflow', body: 'b' } });
    const id = created.json().ticketId as string;
    const detail = await app.inject({ method: 'GET', url: `/v1/tickets/${id}`, headers: h(sup) });
    expect(detail.json().allowedNextStatuses).toEqual(expect.arrayContaining(['in_progress', 'pending_customer']));
    expect(detail.json().allowedNextStatuses).not.toContain('closed');
    await pool.query("DELETE FROM workflow_transitions WHERE workflow_key='smoke-flow'"); await pool.query("DELETE FROM workflow_definitions WHERE workflow_key='smoke-flow'");
  });

  it('de-identifies expired tickets but never ones under legal hold', async () => {
    const sup = await tok(['supervisor'], 'smoke-sup5'); const gw = await tok(['intake-gateway'], 'smoke-gw6', false);
    const make = async (label: string) => {
      const id = (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<ret-${label}-${Date.now()}@x>`, senderReference: 'CUST-REF-00888', subject: `Secret ${label}`, body: 'sensitive words', category: 'service-request' } })).json().ticketId as string;
      await app.inject({ method: 'POST', url: `/v1/tickets/${id}/notes`, headers: h(sup), payload: { visibility: 'internal', body: 'private note' } });
      for (const [toStatus, extra] of [['in_progress', {}], ['resolved', { rootCause: 'other' }], ['closed', {}]] as const) expect((await app.inject({ method: 'POST', url: `/v1/tickets/${id}/status`, headers: h(sup), payload: { toStatus, reason: 'test reason', ...extra } })).statusCode).toBe(201);
      await pool.query("UPDATE tickets SET closed_at = now() - interval '8 years' WHERE id=$1", [id]);
      return id;
    };
    const expired = await make('expired'); const held = await make('held');
    expect((await app.inject({ method: 'PUT', url: `/v1/tickets/${held}/retention`, headers: h(sup), payload: { legalHold: true, holdReason: 'litigation' } })).statusCode).toBe(200);
    const result = await app.get(RetentionService).run('retention-test'); expect(result.redacted).toBeGreaterThanOrEqual(1);
    const row = (await pool.query("SELECT subject,description,redacted_at,category,status FROM tickets WHERE id=$1", [expired])).rows[0];
    expect(row).toMatchObject({ subject: '[redacted]', description: '[redacted]', category: 'service-request', status: 'closed' }); expect(row.redacted_at).not.toBeNull();
    expect((await pool.query("SELECT body FROM ticket_notes WHERE ticket_id=$1", [expired])).rows[0].body).toBe('[redacted]');
    expect((await pool.query("SELECT opaque_reference FROM ticket_references WHERE ticket_id=$1", [expired])).rows[0].opaque_reference).toBe('[redacted]');
    expect((await pool.query("SELECT subject FROM tickets WHERE id=$1", [held])).rows[0].subject).toBe('Secret held');
    expect((await app.inject({ method: 'POST', url: `/v1/tickets/${expired}/status`, headers: h(sup), payload: { toStatus: 'reopened', reason: 'test reason' } })).statusCode).toBe(409);
    expect((await app.get(RetentionService).run('retention-test-2')).redacted).toBe(0);
  });

  it('exposes metrics only to a holder of the metrics token', async () => {
    delete process.env.METRICS_TOKEN; expect((await app.inject({ method: 'GET', url: '/v1/metrics' })).statusCode).toBe(404);
    process.env.METRICS_TOKEN = 'smoke-metrics-token';
    expect((await app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/v1/metrics', headers: { authorization: 'Bearer smoke-metrics-token' } });
    expect(ok.statusCode).toBe(200); expect(ok.body).toContain('http_requests_total'); expect(ok.body).toContain('outbox_events{status="dead_letter"}'); expect(ok.body).toContain('tickets_open');
    delete process.env.METRICS_TOKEN;
  });

  it('releases subject-access data with internal notes and blocked cases withheld', async () => {
    const sup = await tok(['supervisor'], 'smoke-sup6'); const gw = await tok(['intake-gateway'], 'smoke-gw7', false); const ref = `CUST-SAR-${Date.now()}`;
    const mk = async (label: string) => (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<sar-${label}-${Date.now()}@x>`, senderReference: ref, subject: `SAR ${label}`, body: `body ${label}` } })).json().ticketId as string;
    const open = await mk('open'); const blocked = await mk('blocked');
    await app.inject({ method: 'POST', url: `/v1/tickets/${open}/notes`, headers: h(sup), payload: { visibility: 'customer', body: 'hello customer' } });
    await app.inject({ method: 'POST', url: `/v1/tickets/${open}/notes`, headers: h(sup), payload: { visibility: 'internal', body: 'staff view' } });
    await app.inject({ method: 'PUT', url: `/v1/tickets/${blocked}/communication-block`, headers: h(sup), payload: { blocked: true, reason: 'investigation' } });
    const out = await app.inject({ method: 'POST', url: '/v1/privacy/subject-access', headers: h(sup), payload: { reference: ref } }); expect(out.statusCode).toBe(201);
    const body = out.json(); expect(body.released).toHaveLength(1); expect(body.withheldForReview).toBe(1);
    expect(body.released[0]).toMatchObject({ ticketId: open, internalNoteCount: 1, customerNotes: [{ body: 'hello customer' }] }); expect(JSON.stringify(body)).not.toContain('staff view');
    expect((await app.inject({ method: 'POST', url: '/v1/privacy/subject-access', headers: h(await tok(['auditor'], 'smoke-aud')), payload: { reference: ref } })).statusCode).toBe(403);
  });

  it('detects tampering, deleted events and tail truncation in the audit trail, and audits list views', async () => {
    const integrity = app.get(AuditIntegrityService); const sup = await tok(['supervisor'], 'smoke-sup7'); const auditor = await tok(['auditor'], 'smoke-aud2');
    await app.inject({ method: 'GET', url: '/v1/tickets', headers: h(sup) });
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='ticket.list_viewed' AND actor_id='smoke-sup7'")).rows[0].n).toBe(1);

    expect((await integrity.verify(true)).status).toBe('valid');
    const tamper = async (sql: string, args: unknown[] = []) => { await pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only'); try { return await pool.query(sql, args); } finally { await pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only'); } };
    const target = (await pool.query("SELECT sequence,occurred_at FROM audit_events WHERE hash_version=2 ORDER BY sequence DESC OFFSET 3 LIMIT 1")).rows[0];

    // 1. A changed timestamp (which the original design did not protect) is now detected.
    await tamper("UPDATE audit_events SET occurred_at = occurred_at + interval '1 minute' WHERE sequence=$1", [target.sequence]);
    let result = await integrity.verify(true); expect(result).toMatchObject({ status: 'invalid', failureSequence: Number(target.sequence) });
    await tamper('UPDATE audit_events SET occurred_at=$1 WHERE sequence=$2', [target.occurred_at, target.sequence]);
    expect((await integrity.verify(true)).status).toBe('valid');

    // 2. A deleted event in the middle breaks the chain link.
    const middle = (await pool.query('SELECT * FROM audit_events WHERE sequence=$1', [target.sequence])).rows[0];
    await tamper('DELETE FROM audit_events WHERE sequence=$1', [target.sequence]);
    result = await integrity.verify(true); expect(result.status).toBe('invalid');
    await tamper('INSERT INTO audit_events (sequence,id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash,hash_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [middle.sequence, middle.id, middle.occurred_at, middle.actor_id, middle.action, middle.target_type, middle.target_id, middle.correlation_id, middle.outcome, middle.metadata, middle.previous_hash, middle.event_hash, middle.hash_version]);
    expect((await integrity.verify(true)).status).toBe('valid');

    // 3. Deleting the newest events is invisible to linkage but caught by a published anchor.
    expect((await integrity.anchor('anchor-test')).anchored).toBe(true);
    const anchorSequence = (await pool.query('SELECT max(sequence) AS s FROM audit_anchors')).rows[0].s;
    const truncated = (await pool.query('SELECT * FROM audit_events WHERE sequence >= $1 ORDER BY sequence', [anchorSequence])).rows;
    await tamper('DELETE FROM audit_events WHERE sequence >= $1', [anchorSequence]);
    result = await integrity.verify(); expect(result).toMatchObject({ status: 'invalid' }); expect(result.failureReason).toContain('anchor'); // chain links look fine; only the anchor reveals the truncation
    for (const e of truncated) await tamper('INSERT INTO audit_events (sequence,id,occurred_at,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash,hash_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [e.sequence, e.id, e.occurred_at, e.actor_id, e.action, e.target_type, e.target_id, e.correlation_id, e.outcome, e.metadata, e.previous_hash, e.event_hash, e.hash_version]);
    expect((await integrity.verify(true)).status).toBe('valid');
    const status = await app.inject({ method: 'GET', url: '/v1/audit/chain-status', headers: h(auditor) }); expect(status.json().verification.status).toBe('valid'); expect(status.json().lastAnchor).not.toBeNull();

    // 4. Cross-ticket search is scoped and filterable; the search itself is audited.
    const found = await app.inject({ method: 'GET', url: '/v1/audit/events?action=ticket.created&limit=5', headers: h(auditor) }); expect(found.statusCode).toBe(200);
    expect(found.json().events.length).toBeGreaterThan(0); expect(found.json().events.every((e: { action: string }) => e.action.startsWith('ticket.created'))).toBe(true);
    const listViews = await app.inject({ method: 'GET', url: '/v1/audit/events?action=ticket.list_viewed&actor=smoke-sup7', headers: h(auditor) }); expect(listViews.json().events.length).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/v1/audit/events', headers: h(sup) })).statusCode).toBe(403);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='audit.searched'")).rows[0].n).toBeGreaterThan(0);
  });

  it('delivers staff notifications to the right people and tracks read state per person', async () => {
    const agent = await tok(['case-agent'], 'smoke-agent-1'); const sup = await tok(['supervisor'], 'smoke-sup8'); const other = await tok(['case-agent'], 'smoke-agent-other');
    const inbox = async (t: string) => (await app.inject({ method: 'GET', url: '/v1/notifications', headers: h(t) })).json();
    const mine = await inbox(agent); expect(mine.notifications.some((n: { type: string }) => n.type === 'ticket_assigned')).toBe(true); expect(mine.unread).toBeGreaterThan(0);
    expect((await inbox(other)).unread).toBe(0); // someone else's assignment is not theirs
    const supervisors = await inbox(sup); expect(supervisors.notifications.some((n: { type: string }) => n.type === 'sla_at_risk' || n.type === 'ticket_escalated')).toBe(true); // queue supervisors hear about deadlines and escalations
    expect((await app.inject({ method: 'POST', url: '/v1/notifications/read', headers: h(agent), payload: {} })).statusCode).toBe(201);
    expect((await inbox(agent)).unread).toBe(0);
    expect((await inbox(sup)).unread).toBeGreaterThan(0); // reading one person's copy does not mark it read for others
  });

  it('records actor context and before/after values, signs anchors, and archives old events without breaking verification', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const keys = generateKeyPairSync('ed25519'); process.env.AUDIT_ANCHOR_SIGNING_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(); process.env.AUDIT_ANCHOR_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const integrity = app.get(AuditIntegrityService); const sup = await tok(['supervisor'], 'smoke-sup9'); const admin = await tok(['administrator'], 'smoke-admin');
    const gw = await tok(['intake-gateway'], 'smoke-gw9', false);
    const id = (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<ba-${Date.now()}@x>`, senderReference: 'CUST-REF-BA0001', subject: 'Before and after', body: 'original text' } })).json().ticketId as string;

    // before/after values: priority old and new, free text proven by fingerprint only
    await app.inject({ method: 'PATCH', url: `/v1/tickets/${id}`, headers: h(sup), payload: { priority: 'critical', description: 'rewritten text' } });
    const edit = (await pool.query("SELECT metadata FROM audit_events WHERE action='ticket.updated' AND target_id=$1", [id])).rows[0].metadata;
    expect(edit).toMatchObject({ previousPriority: 'normal', newPriority: 'critical', descriptionChanged: true, descriptionOldLength: 13, descriptionNewLength: 14 }); expect(JSON.stringify(edit)).not.toContain('rewritten'); expect(JSON.stringify(edit)).not.toContain('original');
    // configuration changes carry the previous row
    await app.inject({ method: 'PUT', url: '/v1/configuration/sla/default/normal', headers: h(admin), payload: { firstResponseMinutes: 400, resolutionMinutes: 2000, active: true } });
    await app.inject({ method: 'PUT', url: '/v1/configuration/sla/default/normal', headers: h(admin), payload: { firstResponseMinutes: 480, resolutionMinutes: 2880, active: true } });
    const config = (await pool.query("SELECT metadata FROM audit_events WHERE action='configuration.sla_policy_updated' ORDER BY sequence DESC LIMIT 1")).rows[0].metadata;
    expect(JSON.parse(config.previous)).toMatchObject({ first_response_minutes: 400, resolution_minutes: 2000 });

    // signed anchors verify; a forged signature is caught
    const pre = await integrity.verify(true); expect(pre).toMatchObject({ status: 'valid' });
    expect((await integrity.anchor('sign-test')).anchored).toBe(true);
    const anchor = (await pool.query('SELECT sequence,signature FROM audit_anchors ORDER BY sequence DESC LIMIT 1')).rows[0]; expect(anchor.signature).toBeTruthy();
    expect((await integrity.verify(true)).status).toBe('valid');
    await pool.query("UPDATE audit_anchors SET signature='AAAA' WHERE sequence=$1", [anchor.sequence]);
    const forged = await integrity.verify(true); expect(forged).toMatchObject({ status: 'invalid' }); expect(forged.failureReason).toContain('signature');
    await pool.query('UPDATE audit_anchors SET signature=$1 WHERE sequence=$2', [anchor.signature, anchor.sequence]);
    expect((await integrity.verify(true)).status).toBe('valid');

    // archive the oldest events: refuses a damaged range, keeps the live trail verifiable, writes a manifest with a checksum
    const { mkdtempSync, readFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path'); const { createHash } = await import('node:crypto');
    const through = Number((await pool.query('SELECT sequence FROM audit_events ORDER BY sequence OFFSET 20 LIMIT 1')).rows[0].sequence);
    const out = mkdtempSync(join(tmpdir(), 'audit-archive-'));
    const result = await archiveAuditEvents({ connectionString: process.env.DATABASE_URL!, throughSequence: through, outDir: out, archivedBy: 'integration-test', note: 'test' });
    expect(result.count).toBeGreaterThan(10); expect(createHash('sha256').update(readFileSync(result.file)).digest('hex')).toBe(result.sha256);
    expect((await pool.query('SELECT count(*)::int AS n FROM audit_events WHERE sequence <= $1', [through])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='audit_events'::regclass AND tgenabled <> 'O' AND NOT tgisinternal")).rows[0].n).toBe(0); // protections are back on
    expect(await integrity.verify(true)).toMatchObject({ status: 'valid' });
    await expect(archiveAuditEvents({ connectionString: process.env.DATABASE_URL!, throughSequence: 1_000_000_000, outDir: out, archivedBy: 'x' })).rejects.toThrow(/newest audit event must remain/);
    // tampering after an archive is still caught
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER USER'); const victimRow = (await pool.query('SELECT sequence,actor_id FROM audit_events ORDER BY sequence DESC OFFSET 2 LIMIT 1')).rows[0]; const victim = victimRow.sequence;
    await pool.query("UPDATE audit_events SET actor_id='someone-else' WHERE sequence=$1", [victim]); await pool.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
    expect((await integrity.verify(true)).status).toBe('invalid');
    await pool.query('ALTER TABLE audit_events DISABLE TRIGGER USER'); await pool.query('UPDATE audit_events SET actor_id=$2 WHERE sequence=$1', [victim, victimRow.actor_id]); await pool.query('ALTER TABLE audit_events ENABLE TRIGGER USER');
    delete process.env.AUDIT_ANCHOR_SIGNING_PRIVATE_KEY; delete process.env.AUDIT_ANCHOR_PUBLIC_KEY;
  }, 60_000);

  it('lets operators replay dead letters, rejects stale edits, pages lists, and offers trends and reporting views', async () => {
    const admin = await tok(['administrator'], 'ops-admin'); const sup = await tok(['supervisor'], 'ops-sup'); const gw = await tok(['intake-gateway'], 'ops-gw', false);
    // dead-letter tooling
    await pool.query("INSERT INTO integration_outbox (id,event_type,aggregate_type,aggregate_id,correlation_id,payload,status,attempts,last_error) VALUES (gen_random_uuid(),'ticket.created','ticket','dl-1','c','{}','dead_letter',5,'publisher_failure')");
    expect((await app.inject({ method: 'GET', url: '/v1/operations/outbox/summary', headers: h(sup) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/operations/outbox/summary', headers: h(admin) })).json().dead_letter).toBeGreaterThanOrEqual(1);
    const dead = (await app.inject({ method: 'GET', url: '/v1/operations/outbox/events?status=dead_letter', headers: h(admin) })).json(); expect(dead[0]).toMatchObject({ aggregateId: 'dl-1', attempts: 5 }); expect(dead[0].payload).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: `/v1/operations/outbox/events/${dead[0].id}/replay`, headers: h(admin), payload: {} })).json()).toEqual({ replayed: 1 });
    expect((await pool.query('SELECT status,attempts FROM integration_outbox WHERE id=$1', [dead[0].id])).rows[0]).toEqual({ status: 'retry', attempts: 0 });
    expect((await app.inject({ method: 'POST', url: `/v1/operations/outbox/events/${dead[0].id}/replay`, headers: h(admin), payload: {} })).statusCode).toBe(404); // no longer dead-lettered
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='outbox.replayed'")).rows[0].n).toBeGreaterThan(0);

    // optimistic concurrency
    const create = async (n: number) => (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<pg-${n}-${Date.now()}@x>`, senderReference: `CUST-REF-PG${n}00`, subject: `Paging ${n}`, body: 'b' } })).json().ticketId as string;
    const first = await create(1); for (let n = 2; n <= 5; n++) await create(n);
    const seen = (await app.inject({ method: 'GET', url: `/v1/tickets/${first}`, headers: h(sup) })).json().updatedAt as string;
    expect((await app.inject({ method: 'PATCH', url: `/v1/tickets/${first}`, headers: h(sup), payload: { priority: 'high', expectedUpdatedAt: seen } })).statusCode).toBe(200);
    const stale = await app.inject({ method: 'PATCH', url: `/v1/tickets/${first}`, headers: h(sup), payload: { priority: 'low', expectedUpdatedAt: seen } });
    expect(stale.statusCode).toBe(409); expect(stale.json()).toMatchObject({ code: 'stale_ticket' });

    // paging: pages do not overlap, the last page has no cursor, a bad cursor is rejected
    const page1 = await app.inject({ method: 'GET', url: '/v1/tickets?limit=2', headers: h(sup) }); const cursor = page1.headers['x-next-cursor'] as string; expect(page1.json()).toHaveLength(2); expect(cursor).toBeTruthy();
    const page2 = await app.inject({ method: 'GET', url: `/v1/tickets?limit=2&cursor=${cursor}`, headers: h(sup) }); const ids1 = page1.json().map((t: { id: string }) => t.id);
    expect(page2.json().some((t: { id: string }) => ids1.includes(t.id))).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/v1/tickets?cursor=not-a-cursor', headers: h(sup) })).statusCode).toBe(400);
    const everything = new Set<string>(); let next: string | undefined; do { const r = await app.inject({ method: 'GET', url: `/v1/tickets?limit=3${next ? `&cursor=${next}` : ''}`, headers: h(sup) }); r.json().forEach((t: { id: string }) => everything.add(t.id)); next = r.headers['x-next-cursor'] as string | undefined; } while (next);
    expect(everything.size).toBeGreaterThanOrEqual(5);

    // trends
    const trends = (await app.inject({ method: 'GET', url: '/v1/dashboard/trends?weeks=4', headers: h(sup) })).json(); expect(trends.series).toHaveLength(4); expect(trends.series[3].created).toBeGreaterThanOrEqual(5); expect(trends.byCategory.length).toBeGreaterThan(0);

    // reporting views exclude free text
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='reporting' AND table_name='tickets'")).rows.map((r) => r.column_name);
    expect(columns).toEqual(expect.arrayContaining(['status', 'resolved_at', 'regulatory_status'])); expect(columns).not.toContain('subject'); expect(columns).not.toContain('description'); expect(columns).not.toContain('custom_fields');
    expect((await pool.query('SELECT count(*)::int AS n FROM reporting.tickets')).rows[0].n).toBeGreaterThan(0);
  });

  it('keeps the audit chain valid under many concurrent writers', async () => {
    const sup = await tok(['supervisor'], 'stress-sup'); const gw = await tok(['intake-gateway'], 'stress-gw', false);
    const ids = await Promise.all(Array.from({ length: 12 }, (_, n) => app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<stress-${n}-${Date.now()}@x>`, senderReference: `CUST-REF-ST${String(n).padStart(4, '0')}`, subject: `Stress ${n}`, body: 'b' } }).then((r) => r.json().ticketId as string)));
    await Promise.all(ids.flatMap((id) => [
      app.inject({ method: 'POST', url: `/v1/tickets/${id}/notes`, headers: h(sup), payload: { visibility: 'internal', body: 'concurrent note' } }),
      app.inject({ method: 'GET', url: `/v1/tickets/${id}`, headers: h(sup) }),
      app.inject({ method: 'GET', url: '/v1/tickets', headers: h(sup) }),
      app.inject({ method: 'PATCH', url: `/v1/tickets/${id}`, headers: h(sup), payload: { priority: 'high' } })
    ]));
    const result = await app.get(AuditIntegrityService).verify(true);
    expect(result).toMatchObject({ status: 'valid' }); expect(result.eventsChecked).toBeGreaterThan(100);
  }, 60_000);

  it('counts SLA time in business hours and stops the clock while waiting for the customer', async () => {
    const admin = await tok(['administrator'], 'cal-admin'); const sup = await tok(['supervisor'], 'cal-sup'); const gw = await tok(['intake-gateway'], 'cal-gw', false);
    const policy = (payload: object) => app.inject({ method: 'PUT', url: '/v1/configuration/sla/default/normal', headers: h(admin), payload: payload as object });
    try {
      expect((await policy({ firstResponseMinutes: 120, resolutionMinutes: 960, active: true, calendar: 'business', pauseWhilePendingCustomer: true })).statusCode).toBe(200);
      const id = (await app.inject({ method: 'POST', url: '/v1/intake/email', headers: h(gw), payload: { messageId: `<cal-${Date.now()}@x>`, senderReference: 'CUST-REF-CAL001', subject: 'Calendar', body: 'b' } })).json().ticketId as string;
      const due = (await pool.query('SELECT created_at,resolution_due_at FROM tickets WHERE id=$1', [id])).rows[0];
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(due.resolution_due_at); const part = (t: string) => local.find((p) => p.type === t)!.value;
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(part('weekday')); const minute = Number(part('hour')) * 60 + Number(part('minute')); expect(minute).toBeGreaterThanOrEqual(570); expect(minute).toBeLessThanOrEqual(1050); // inside 09:30-17:30 India time
      expect(due.resolution_due_at.getTime() - due.created_at.getTime()).toBeGreaterThanOrEqual(960 * 60_000); // working time is never shorter than wall time

      const move = (toStatus: string) => app.inject({ method: 'POST', url: `/v1/tickets/${id}/status`, headers: h(sup), payload: { toStatus, reason: 'calendar test' } });
      expect((await move('in_progress')).statusCode).toBe(201); expect((await move('pending_customer')).statusCode).toBe(201);
      expect((await pool.query('SELECT sla_paused_at FROM tickets WHERE id=$1', [id])).rows[0].sla_paused_at).not.toBeNull();
      await app.get(WorkflowScheduler).tick(); expect((await pool.query('SELECT sla_status FROM tickets WHERE id=$1', [id])).rows[0].sla_status).toBe('paused');

      await pool.query("UPDATE tickets SET sla_paused_at = now() - interval '2 hours' WHERE id=$1", [id]);
      const before = (await pool.query('SELECT resolution_due_at FROM tickets WHERE id=$1', [id])).rows[0].resolution_due_at as Date;
      expect((await move('in_progress')).statusCode).toBe(201);
      const after = (await pool.query('SELECT resolution_due_at,sla_paused_at FROM tickets WHERE id=$1', [id])).rows[0];
      expect(after.sla_paused_at).toBeNull(); expect(Math.round((after.resolution_due_at.getTime() - before.getTime()) / 60_000)).toBeGreaterThanOrEqual(119); // moved out by the two hours spent waiting
    } finally { await policy({ firstResponseMinutes: 480, resolutionMinutes: 2880, active: true }); }
    const bh = await app.inject({ method: 'GET', url: '/v1/configuration/business-hours', headers: h(admin) }); expect(bh.json()).toMatchObject({ country: 'IN', startMinute: 570 });
  });
});
