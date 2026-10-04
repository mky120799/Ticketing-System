import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { checkAuditPrivileges } from '../src/database/database-guard.service.js';

// Needs a PostgreSQL superuser in DATABASE_URL: ROLES_TEST=1
const run = process.env.ROLES_TEST === '1';
(run ? describe : describe.skip)('restricted runtime database account', () => {
  const dbName = `roles_t_${Date.now()}`; let admin: Pool; let owner: Pool; let app: Pool; const base = new URL(process.env.DATABASE_URL!);
  const urlFor = (user: string, password: string, db: string) => { const u = new URL(base.toString()); u.username = user; u.password = password; u.pathname = `/${db}`; return u.toString(); };
  const sql = () => readFileSync(new URL('../../../infra/postgres/roles.sql', import.meta.url), 'utf8').replace(/case_owner/g, 'case_owner_t').replace(/case_app/g, 'case_app_t').replace(/case_reporting/g, 'case_reporting_t').replace('${OWNER_PASSWORD}', 'owner-pw').replace('${APP_PASSWORD}', 'app-pw').replace('${REPORTING_PASSWORD}', 'report-pw');

  beforeAll(async () => {
    admin = new Pool({ connectionString: urlFor(base.username, base.password, 'postgres') }); await admin.query(`CREATE DATABASE ${dbName}`);
    const adminDb = new Pool({ connectionString: urlFor(base.username, base.password, dbName) });
    await adminDb.query(sql());                                                                    // roles + schema ownership (before tables exist)
    execFileSync('npm', ['run', 'migration:run'], { env: { ...process.env, DATABASE_URL: urlFor('case_owner_t', 'owner-pw', dbName) }, stdio: 'pipe' });
    await adminDb.query(sql()); await adminDb.end();                                              // grants/revocations on the now-existing tables (idempotent)
    owner = new Pool({ connectionString: urlFor('case_owner_t', 'owner-pw', dbName) }); app = new Pool({ connectionString: urlFor('case_app_t', 'app-pw', dbName) });
  }, 120_000);
  afterAll(async () => { await app?.end(); await owner?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await admin?.query('DROP OWNED BY case_app_t'); await admin?.query('DROP OWNED BY case_reporting_t'); await admin?.query('DROP ROLE IF EXISTS case_reporting_t'); await admin?.query('DROP OWNED BY case_owner_t'); await admin?.query('DROP ROLE IF EXISTS case_app_t'); await admin?.query('DROP ROLE IF EXISTS case_owner_t'); await admin?.end(); });

  const insert = () => app.query(`INSERT INTO audit_events (id,actor_id,action,target_type,target_id,correlation_id,outcome,metadata,previous_hash,event_hash,hash_version) VALUES (gen_random_uuid(),'a','x','t','1','c','success','{}',NULL,'${'0'.repeat(64)}',2)`);

  it('can add and read audit events but cannot change, remove, truncate or disable protection', async () => {
    await expect(insert()).resolves.toBeDefined();
    expect((await app.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n).toBe(1);
    await expect(app.query("UPDATE audit_events SET action='tampered'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_events')).rejects.toThrow(/permission denied/);
    await expect(app.query('TRUNCATE audit_events')).rejects.toThrow(/permission denied/);
    await expect(app.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only')).rejects.toThrow(/must be owner/);
    await expect(app.query('DROP TABLE audit_events')).rejects.toThrow(/must be owner/);
    await expect(app.query("UPDATE audit_anchors SET head_hash='x'")).rejects.toThrow(/permission denied/);
  });

  it('can still do its everyday work on case tables', async () => {
    await expect(app.query("SELECT count(*) FROM tickets")).resolves.toBeDefined();
    await expect(app.query("UPDATE case_queues SET active=active")).resolves.toBeDefined();
  });

  it('is reported safe for the application account and unsafe for the owner', async () => {
    const asApp = await checkAuditPrivileges(app.query.bind(app) as never); expect(asApp).toMatchObject({ safe: true, role: 'case_app_t' });
    const asOwner = await checkAuditPrivileges(owner.query.bind(owner) as never); expect(asOwner.safe).toBe(false); expect(asOwner.reasons).toContain('owns the audit table');
  });

  it('gives the reporting account the reporting views and nothing else', async () => {
    const reporting = new Pool({ connectionString: urlFor('case_reporting_t', 'report-pw', dbName) });
    try {
      await expect(reporting.query('SELECT count(*) FROM reporting.tickets')).resolves.toBeDefined();
      await expect(reporting.query('SELECT count(*) FROM tickets')).rejects.toThrow(/permission denied/);
      await expect(reporting.query('SELECT count(*) FROM ticket_notes')).rejects.toThrow(/permission denied/);
      await expect(reporting.query('SELECT count(*) FROM audit_events')).rejects.toThrow(/permission denied/);
      const columns = (await reporting.query("SELECT column_name FROM information_schema.columns WHERE table_schema='reporting' AND table_name='tickets'")).rows.map((r) => r.column_name);
      expect(columns).not.toEqual(expect.arrayContaining(['subject'])); expect(columns).not.toEqual(expect.arrayContaining(['description']));
    } finally { await reporting.end(); }
  });

  it('keeps the truncate guard even for the owner', async () => {
    await expect(owner.query('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
  });
});
