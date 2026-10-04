import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import { requestContext } from '../audit/request-context.js';
import { assertAllowedClient, assertTokenActive, lookupEntitlements, type EntitlementOverride } from './token-checks.js';
import type { CaseRole, UserContext } from './user-context.js';

const ROLES: CaseRole[] = ['branch-agent', 'call-center-agent', 'case-agent', 'supervisor', 'auditor', 'administrator', 'attachment-scanner', 'integration-reconciler', 'notification-provider', 'intake-gateway'];
const SERVICE_ROLES: CaseRole[] = ['attachment-scanner', 'integration-reconciler', 'notification-provider', 'intake-gateway'];

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly issuer = process.env.OIDC_ISSUER ?? '';
  private readonly audience = process.env.OIDC_AUDIENCE ?? '';
  private readonly jwks = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URI ?? 'http://invalid.local/jwks'));

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer access token');
    if (!this.issuer || !this.audience) throw new UnauthorizedException('OIDC validation is not configured');
    try {
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, { issuer: this.issuer, audience: this.audience, algorithms: ['RS256', 'ES256', 'PS256'] });
      assertAllowedClient(payload);
      await assertTokenActive(authorization.slice(7));
      request.user = this.toUserContext(payload, await lookupEntitlements(typeof payload.sub === 'string' ? payload.sub : ''));
      const context = requestContext.getStore(); if (context) { context.tokenId = request.user.tokenId; context.acr = request.user.acr; context.authenticatedAt = request.user.authTime; }
      request.correlationId = this.headerValue(request.headers['x-correlation-id']) ?? crypto.randomUUID();
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private toUserContext(payload: JWTPayload, override: EntitlementOverride | null): UserContext {
    if (typeof payload.sub !== 'string') throw new UnauthorizedException('Token subject is missing');
    const roleClaims = override?.roles ?? (Array.isArray(payload.roles) ? payload.roles : (payload.realm_access as { roles?: unknown[] } | undefined)?.roles ?? []);
    const roles = roleClaims.filter((role): role is CaseRole => typeof role === 'string' && ROLES.includes(role as CaseRole));
    const branch = override?.branch ?? this.stringClaim(payload, 'branch');
    const queueClaim = override?.queues ?? (Array.isArray(payload.queues) ? payload.queues : []);
    const queues = queueClaim.filter((queue): queue is string => typeof queue === 'string');
    const department = override?.department ?? this.stringClaim(payload, 'department');
    const legalEntity = override?.legal_entity ?? this.stringClaim(payload, 'legal_entity');
    const country = override?.country ?? this.stringClaim(payload, 'country');
    if (!roles.length) throw new UnauthorizedException('Required authorization claims are missing');
    const serviceIdentity = roles.some((role) => SERVICE_ROLES.includes(role));
    if (!serviceIdentity && (!branch || !department || !legalEntity || !country)) throw new UnauthorizedException('Required authorization claims are missing');
    return { subject: payload.sub, roles, branch, queues, department, legalEntity, country, serviceIdentity, tokenId: typeof payload.jti === 'string' ? payload.jti : undefined, tokenExpiresAt: typeof payload.exp === 'number' ? payload.exp : undefined, authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined, acr: typeof payload.acr === 'string' ? payload.acr : undefined };
  }

  private stringClaim(payload: JWTPayload, claim: string): string { return typeof payload[claim] === 'string' ? payload[claim] : ''; }
  private headerValue(value: string | string[] | undefined): string | undefined { return typeof value === 'string' && value.length <= 128 ? value : undefined; }
}
