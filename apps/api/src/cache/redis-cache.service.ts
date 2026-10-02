import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';

/**
 * Redis is deliberately a non-authoritative, fail-open cache. PostgreSQL remains
 * the source of truth for every configuration and case decision.
 */
@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly client = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
  private connecting: Promise<void> | null = null;
  private disabled = false;

  constructor() {
    this.client?.on('error', () => {
      this.disabled = true;
    });
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!(await this.ready())) return null;
    try {
      const value = await this.client!.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      this.disabled = true;
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!(await this.ready())) return;
    try {
      await this.client!.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      this.disabled = true;
    }
  }

  async delete(key: string): Promise<void> {
    if (!(await this.ready())) return;
    try {
      await this.client!.del(key);
    } catch {
      this.disabled = true;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }

  private async ready(): Promise<boolean> {
    if (!this.client || this.disabled) return false;
    if (this.client.isReady) return true;
    this.connecting ??= this.client.connect().then(() => undefined).catch(() => {
      this.disabled = true;
    });
    await this.connecting;
    return this.client.isReady && !this.disabled;
  }
}
