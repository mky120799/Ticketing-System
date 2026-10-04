import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { acceptEmptyJsonBodies, registerRequestContext } from './audit/request-context.js';
import { assertProductionSafety } from './production-safety.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  assertProductionSafety();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: Number(process.env.MAX_BODY_BYTES ?? 1_048_576), trustProxy: process.env.TRUST_PROXY === 'true' }));
  // The API returns JSON only: lock the browser-facing surface down, and cap request rates per client.
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, hsts: { maxAge: 31_536_000, includeSubDomains: true }, referrerPolicy: { policy: 'no-referrer' } });
  await app.register(rateLimit, { max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600), timeWindow: '1 minute', allowList: (request) => request.url.startsWith('/v1/health') || request.url.startsWith('/v1/metrics') || request.url.startsWith('/v1/events/stream') });
  registerRequestContext(app.getHttpAdapter().getInstance());
  acceptEmptyJsonBodies(app);
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id'], exposedHeaders: ['x-next-cursor'], maxAge: 600 });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}
void bootstrap();
