import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { CreatePortalRequestDto, PortalAttachmentDto, PortalMessageDto } from './portal.dto.js';
import { CompleteAttachmentDto } from '../tickets/ticket.dto.js';
import { PortalAttachmentsService } from './portal-attachments.service.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { PortalService } from './portal.service.js';

@Controller('portal')
@UseGuards(PortalAuthGuard)
export class PortalController {
  constructor(private readonly portal: PortalService, private readonly attachments: PortalAttachmentsService) {}
  @Header('Cache-Control', 'no-store') @Post('requests') create(@Req() r: FastifyRequest, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreatePortalRequestDto) { return this.portal.create(r.customer!.subject, dto, (key && key.length <= 100 && /^[\x21-\x7e]+$/.test(key) ? key : randomUUID()), r.correlationId!); }
  @Header('Cache-Control', 'no-store') @Get('requests') list(@Req() r: FastifyRequest) { return this.portal.list(r.customer!.subject); }
  @Header('Cache-Control', 'no-store') @Get('requests/:id') detail(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) { return this.portal.detail(r.customer!.subject, id); }
  @Header('Cache-Control', 'no-store') @Post('requests/:id/messages') async reply(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalMessageDto) { await this.portal.reply(r.customer!.subject, id, dto.body); return { ok: true }; }
  @Header('Cache-Control', 'no-store') @Post('requests/:id/attachments') addDocument(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PortalAttachmentDto) { return this.attachments.createIntent(r.customer!.subject, id, dto, r.correlationId!); }
  @Header('Cache-Control', 'no-store') @Post('requests/:id/attachments/:attachmentId/complete') completeDocument(@Req() r: FastifyRequest, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Body() dto: CompleteAttachmentDto) { return this.attachments.complete(r.customer!.subject, id, attachmentId, dto, r.correlationId!); }
}
