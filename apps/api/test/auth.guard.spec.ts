import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard.js';

const issuer = 'http://127.0.0.1:0/realms/test';
const audience = 'bank-case-api';

describe('OIDC JWT guard', () => {
  let server: Server;
  let privateKey: KeyLike;
  let publicJwk: JWK;
  let jwksUri: string;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    server = createServer((request, response) => {
      if (request.url?.endsWith('/jwks')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ keys: [publicJwk] })); return; }
      response.statusCode = 404; response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('JWKS server did not start');
    const baseIssuer = `http://127.0.0.1:${address.port}/realms/test`;
    jwksUri = `http://127.0.0.1:${address.port}/jwks`;
    process.env.OIDC_ISSUER = baseIssuer;
    process.env.OIDC_AUDIENCE = audience;
    process.env.OIDC_JWKS_URI = jwksUri;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it('rejects an invalid token', async () => {
    await expect(new AuthGuard().canActivate(context('not-a-jwt'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const token = await signToken(Math.floor(Date.now() / 1000) - 60);
    await expect(new AuthGuard().canActivate(context(token))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token with required authorization claims', async () => {
    const token = await signToken(Math.floor(Date.now() / 1000) + 300);
    const request: { headers: Record<string, string>; user?: unknown; correlationId?: string } = { headers: { authorization: `Bearer ${token}` } };
    await expect(new AuthGuard().canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never)).resolves.toBe(true);
    expect(request.user).toMatchObject({ subject: 'test-user', branch: 'BLR-01', queues: ['payments'] });
  });

  it('accepts a dedicated service token without human branch claims', async () => {
    const token = await new SignJWT({ roles: ['attachment-scanner'] }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(process.env.OIDC_ISSUER!).setAudience(audience).setSubject('scanner-service').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 300).sign(privateKey);
    const request: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: `Bearer ${token}` } };
    await expect(new AuthGuard().canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never)).resolves.toBe(true);
    expect(request.user).toMatchObject({ subject: 'scanner-service', roles: ['attachment-scanner'], serviceIdentity: true });
  });

  async function signToken(expiration: number): Promise<string> {
    const currentIssuer = process.env.OIDC_ISSUER!;
    return new SignJWT({ roles: ['case-agent'], branch: 'BLR-01', queues: ['payments'], department: 'operations', legal_entity: 'BANK-IN', country: 'IN' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(currentIssuer).setAudience(audience).setSubject('test-user').setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  }
  function context(token: string) { return { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as never; }
});
