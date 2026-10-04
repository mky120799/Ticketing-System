import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' { interface FastifyRequest { customer?: { subject: string }; } }

/**
 * Authenticates customers against the CUSTOMER identity provider (separate issuer, audience and keys from staff).
 * A customer token can never satisfy the staff guard and a staff token can never satisfy this one, because each checks
 * its own issuer and audience. Disabled (404) unless PORTAL_OIDC_* is configured.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  private readonly issuer = process.env.PORTAL_OIDC_ISSUER ?? '';
  private readonly audience = process.env.PORTAL_OIDC_AUDIENCE ?? '';
  private readonly jwks = this.issuer ? createRemoteJWKSet(new URL(process.env.PORTAL_OIDC_JWKS_URI ?? `${this.issuer}/protocol/openid-connect/certs`)) : null;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.issuer || !this.audience || !this.jwks) throw new NotFoundException();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer access token');
    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, { issuer: this.issuer, audience: this.audience, algorithms: ['RS256', 'ES256', 'PS256'] });
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('no subject');
      request.customer = { subject: payload.sub };
      request.correlationId = typeof request.headers['x-correlation-id'] === 'string' && request.headers['x-correlation-id'].length <= 128 ? request.headers['x-correlation-id'] : crypto.randomUUID();
      return true;
    } catch { throw new UnauthorizedException('Invalid or expired access token'); }
  }
}
