import { Global, Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service.js';

@Global()
@Module({ providers: [RedisCacheService], exports: [RedisCacheService] })
export class CacheModule {}
