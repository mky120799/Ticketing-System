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
});
