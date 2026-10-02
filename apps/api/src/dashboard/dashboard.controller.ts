import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { DashboardService } from './dashboard.service.js';
import { SlaService } from '../tickets/sla.service.js';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly sla: SlaService) {}
  @Get('summary') summary(@Req() request: FastifyRequest) { return this.dashboard.summary(request.user!, request.correlationId!); }
  @Post('sla/reconcile') reconcileSla(@Req() request: FastifyRequest) { return this.sla.reconcile(request.user!, request.correlationId!); }
}
