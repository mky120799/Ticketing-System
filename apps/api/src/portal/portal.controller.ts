import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { CreatePortalRequestDto, PortalMessageDto } from './portal.dto.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalService } from './portal.service.js';

@Controller('portal')
@UseGuards(PortalAuthGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}
  @Header('Cache-Control', 'no-store') @Post('requests') create(@Req() r: FastifyRequest, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreatePortalRequestDto) { return this.portal.create(r.customer!.subject, dto, (key && key.length <= 100 && /^[\x21-\x7e]+$/.test(key) ? key : randomUUID()), r.correlationId!); }
  @Header('Cache-Control', 'no-store') @Get('requests') list(@Req() r: FastifyRequest) { return this.portal.list(r.customer!.subject); }
  @Header('Cache-Control', 'no-store') @Get('requests/:id') detail(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) { return this.portal.detail(r.customer!.subject, id); }
  @Header('Cache-Control', 'no-store') @Post('requests/:id/messages') async reply(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalMessageDto) { await this.portal.reply(r.customer!.subject, id, dto.body); return { ok: true }; }
}
