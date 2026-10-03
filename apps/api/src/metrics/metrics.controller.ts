import { Controller, Get, Header, NotFoundException, Req, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { MetricsService } from './metrics.service.js';

/** Scrape endpoint. Disabled unless METRICS_TOKEN is set; then it requires `Authorization: Bearer <token>`. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get() @Header('Content-Type', 'text/plain; version=0.0.4') @Header('Cache-Control', 'no-store')
  async scrape(@Req() request: FastifyRequest): Promise<string> {
    const token = process.env.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    const presented = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    const a = Buffer.from(presented); const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return this.metrics.render();
  }
}
