import { RedisCacheService } from '../src/cache/redis-cache.service.js';

describe('RedisCacheService', () => {
  const originalUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalUrl;
  });

  it('fails open when Redis is not configured', async () => {
    delete process.env.REDIS_URL;
    const cache = new RedisCacheService();

    await expect(cache.getJson('missing')).resolves.toBeNull();
    await expect(cache.setJson('key', { safe: true }, 30)).resolves.toBeUndefined();
    await expect(cache.delete('key')).resolves.toBeUndefined();
    await expect(cache.onModuleDestroy()).resolves.toBeUndefined();
  });
});
