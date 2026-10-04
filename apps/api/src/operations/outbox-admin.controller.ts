import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { OutboxAdminService } from './outbox-admin.service.js';

class ReplayDto { @IsOptional() @IsString() @Length(2, 100) eventType?: string; }

@Controller('operations/outbox')
@UseGuards(AuthGuard)
export class OutboxAdminController {
  constructor(private readonly outbox: OutboxAdminService) {}
  @Get('summary') summary(@Req() r: FastifyRequest) { return this.outbox.summary(r.user!); }
  @Get('events') list(@Req() r: FastifyRequest, @Query('status') status = 'dead_letter', @Query('limit') limit?: string) { return this.outbox.list(r.user!, status, limit ? Number(limit) : 50); }
  @Post('events/:id/replay') replayOne(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) { return this.outbox.replay(r.user!, r.correlationId!, { id }); }
  @Post('replay') replayAll(@Req() r: FastifyRequest, @Body() dto: ReplayDto) { return this.outbox.replay(r.user!, r.correlationId!, { eventType: dto.eventType }); }
}
