import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Facts about the current request that an auditor needs next to every action: where it came from and how strongly the user authenticated. */
export interface RequestAuditContext { ip?: string; userAgent?: string; tokenId?: string; acr?: string; authenticatedAt?: number; }
export const requestContext = new AsyncLocalStorage<RequestAuditContext>();

/** Browsers send `Content-Type: application/json` even on actions with no body (for example "replay"); treat an empty body as `{}` instead of rejecting it. */
export function acceptEmptyJsonBodies(app: NestFastifyApplication): void {
  app.useBodyParser('application/json', {}, (_request, body: Buffer, done) => {
    if (!body || body.length === 0) { done(null, {}); return; }
    try { done(null, JSON.parse(body.toString('utf8'))); } catch (error) { (error as { statusCode?: number }).statusCode = 400; done(error as Error, undefined); }
  });
}

/** Wraps every request in its own context. Guards fill in the identity fields once the token is verified. */
export function registerRequestContext(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, _reply, done) => {
    const userAgent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 200) : undefined;
    requestContext.run({ ip: request.ip, userAgent }, done);
  });
}
