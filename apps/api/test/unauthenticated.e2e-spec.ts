import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';

describe('protected API boundary', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { if (app) await app.close(); });
  it('rejects an unauthenticated profile request', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
  });
  it('rejects a malformed bearer token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer not-a-jwt' } });
    expect(response.statusCode).toBe(401);
  });
});
