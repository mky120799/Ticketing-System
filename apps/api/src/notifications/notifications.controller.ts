import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { PolicyService } from '../auth/policy.service.js';
import { NotificationsService } from './notifications.service.js';

class MarkReadDto { @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids?: string[]; }

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService, private readonly policy: PolicyService) {}
  @Get() inbox(@Req() r: FastifyRequest) { this.policy.assertPermission(r.user!, 'ticket:read'); return this.notifications.inbox(r.user!); }
  @Post('read') async read(@Req() r: FastifyRequest, @Body() dto: MarkReadDto) { this.policy.assertPermission(r.user!, 'ticket:read'); await this.notifications.markRead(r.user!, dto.ids?.length ? dto.ids : 'all'); return { ok: true }; }
}
