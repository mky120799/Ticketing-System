import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { tap, type Observable } from 'rxjs';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp(); const request = http.getRequest<FastifyRequest>(); const reply = http.getResponse<FastifyReply>();
    const route = request.routeOptions?.url ?? 'unknown'; const method = request.method; const end = this.metrics.httpDuration.startTimer({ method, route });
    const done = (status: number) => { end(); this.metrics.httpRequests.inc({ method, route, status: String(status) }); };
    return next.handle().pipe(tap({ next: () => done(reply.statusCode), error: (error: { getStatus?: () => number }) => done(error.getStatus?.() ?? 500) }));
  }
}
