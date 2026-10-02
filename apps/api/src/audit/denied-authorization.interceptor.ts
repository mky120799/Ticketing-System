import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { AuditService } from './audit.service.js';
import { PgService } from '../database/pg.service.js';

@Injectable()
export class DeniedAuthorizationInterceptor implements NestInterceptor {
  constructor(private readonly db: PgService, private readonly audit: AuditService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((error: unknown) => {
      const status = typeof error === 'object' && error !== null && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : 500;
      const request = context.switchToHttp().getRequest<FastifyRequest>();
      if (status === 403 && request.user && request.correlationId) {
        const ticketId = (request.params as { ticketId?: string } | undefined)?.ticketId ?? 'not-applicable';
        return from(this.db.transaction((client) => this.audit.write(client, { actorId: request.user!.subject, action: 'authorization.denied', targetType: 'ticket', targetId: ticketId, correlationId: request.correlationId!, outcome: 'denied', metadata: { path: request.url.slice(0, 160) } }))).pipe(
          mergeMap(() => throwError(() => error)),
          catchError(() => throwError(() => error))
        );
      }
      return throwError(() => error);
    }));
  }
}
