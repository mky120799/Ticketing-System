import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard.js';
import { assertStepUp } from '../src/auth/token-checks.js';
import type { UserContext } from '../src/auth/user-context.js';

describe('authentication hardening', () => {
  let server: Server; let privateKey: KeyLike; let base: string; let introspectionActive = true; let introspectionDown = false; let entitlement: Record<string, unknown> | null = null;
  const envBackup = { ...process.env };
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256'); privateKey = keys.privateKey; const jwk: JWK = { ...(await exportJWK(keys.publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/jwks') { res.end(JSON.stringify({ keys: [jwk] })); return; }
      if (req.url === '/introspect') { if (introspectionDown) { res.statusCode = 500; res.end('{}'); return; } res.end(JSON.stringify({ active: introspectionActive })); return; }
      if (req.url?.startsWith('/entitlements')) { if (entitlement) { res.end(JSON.stringify(entitlement)); return; } res.statusCode = 404; res.end('{}'); return; }
      res.statusCode = 404; res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); const a = server.address(); if (!a || typeof a === 'string') throw new Error('x'); base = `http://127.0.0.1:${a.port}`;
    Object.assign(process.env, { OIDC_ISSUER: `${base}/realms/t`, OIDC_AUDIENCE: 'bank-case-api', OIDC_JWKS_URI: `${base}/jwks` });
  });
  afterAll(async () => { process.env = envBackup; await new Promise<void>((r) => server.close(() => r())); });
  afterEach(() => { for (const k of ['AUTH_ALLOWED_CLIENTS', 'AUTH_INTROSPECTION_URL', 'AUTH_INTROSPECTION_FAIL_OPEN', 'ENTITLEMENT_URL', 'ENTITLEMENT_CACHE_SECONDS', 'AUTH_INTROSPECTION_CACHE_SECONDS']) delete process.env[k]; introspectionActive = true; introspectionDown = false; entitlement = null; });

  const token = (claims: Record<string, unknown> = {}, sub = `user-${Math.random()}`) => new SignJWT({ roles: ['case-agent'], branch: 'B1', queues: ['payments'], department: 'ops', legal_entity: 'E1', country: 'AU', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuer(process.env.OIDC_ISSUER!).setAudience('bank-case-api').setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const run = async (t: string) => { const request: { headers: Record<string, string>; user?: UserContext } = { headers: { authorization: `Bearer ${t}` } }; await new AuthGuard().canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never); return request.user!; };

  it('rejects tokens signed with a symmetric algorithm', async () => {
    const forged = await new SignJWT({ roles: ['supervisor'] }).setProtectedHeader({ alg: 'HS256' }).setIssuer(process.env.OIDC_ISSUER!).setAudience('bank-case-api').setSubject('x').setExpirationTime('5m').sign(new TextEncoder().encode('shared-secret-shared-secret-1234567890'));
    await expect(run(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts only tokens issued to an allowed application when configured', async () => {
    process.env.AUTH_ALLOWED_CLIENTS = 'bank-case-web, intake-gateway';
    await expect(run(await token({ azp: 'some-other-app' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(run(await token())).rejects.toBeInstanceOf(UnauthorizedException); // no azp at all
    await expect(run(await token({ azp: 'bank-case-web' }))).resolves.toMatchObject({ roles: ['case-agent'] });
  });

  it('refuses revoked tokens when introspection is configured, and fails closed if the lookup breaks', async () => {
    process.env.AUTH_INTROSPECTION_URL = `${base}/introspect`; process.env.AUTH_INTROSPECTION_CACHE_SECONDS = '0';
    await expect(run(await token())).resolves.toBeDefined();
    introspectionActive = false; await expect(run(await token())).rejects.toBeInstanceOf(UnauthorizedException);
    introspectionActive = true; introspectionDown = true; await expect(run(await token())).rejects.toBeInstanceOf(UnauthorizedException);
    process.env.AUTH_INTROSPECTION_FAIL_OPEN = 'true'; await expect(run(await token())).resolves.toBeDefined();
  });

  it('takes roles and scope from the central entitlement service when configured', async () => {
    process.env.ENTITLEMENT_URL = `${base}/entitlements`; process.env.ENTITLEMENT_CACHE_SECONDS = '0';
    entitlement = { roles: ['supervisor'], queues: ['fraud', 'cards'], branch: 'B9' };
    await expect(run(await token())).resolves.toMatchObject({ roles: ['supervisor'], queues: ['fraud', 'cards'], branch: 'B9', department: 'ops' });
    entitlement = null; await expect(run(await token())).rejects.toBeInstanceOf(UnauthorizedException); // unknown to the bank's service: no access
  });

  describe('step-up', () => {
    const user = (over: Partial<UserContext> = {}): UserContext => ({ subject: 's', roles: ['supervisor'], branch: '', queues: [], department: '', legalEntity: '', country: '', ...over });
    afterEach(() => { delete process.env.STEP_UP_MAX_AGE_SECONDS; delete process.env.STEP_UP_ACR_VALUES; });
    it('does nothing unless configured', () => { expect(() => assertStepUp(user(), 'x')).not.toThrow(); });
    it('requires a recent login', () => {
      process.env.STEP_UP_MAX_AGE_SECONDS = '300';
      expect(() => assertStepUp(user({ authTime: Math.floor(Date.now() / 1000) - 60 }), 'x')).not.toThrow();
      expect(() => assertStepUp(user({ authTime: Math.floor(Date.now() / 1000) - 3600 }), 'x')).toThrow(ForbiddenException);
      expect(() => assertStepUp(user(), 'x')).toThrow(ForbiddenException);
    });
    it('accepts a strong authentication level even if the login is old', () => {
      process.env.STEP_UP_MAX_AGE_SECONDS = '300'; process.env.STEP_UP_ACR_VALUES = 'mfa,2';
      expect(() => assertStepUp(user({ acr: 'mfa', authTime: 1 }), 'x')).not.toThrow();
      expect(() => assertStepUp(user({ acr: '1', authTime: 1 }), 'x')).toThrow(ForbiddenException);
    });
    it('exempts automated service identities and uses a machine-readable code', () => {
      process.env.STEP_UP_MAX_AGE_SECONDS = '300';
      expect(() => assertStepUp(user({ serviceIdentity: true }), 'x')).not.toThrow();
      try { assertStepUp(user(), 'export data'); } catch (error) { expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'step_up_required' }); }
    });
  });
});
