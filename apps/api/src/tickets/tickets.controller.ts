import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { AddNoteDto, ApprovalDecisionDto, ApprovalRequestDto, AssignTicketDto, AttachmentScanResultDto, CompleteAttachmentDto, CreateAttachmentDto, CreateCommunicationDto, CreateTicketDto, LinkTicketDto, SearchTicketsQuery, TransitionTicketDto, UpdateRetentionControlDto, UpdateTicketDto } from './ticket.dto.js';
import { TicketsService } from './tickets.service.js';

@Controller('tickets')
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}
  @Post() create(@Req() request: FastifyRequest, @Headers('idempotency-key') key: string | undefined, @Body() dto: CreateTicketDto) { if (!key || key.length > 128) throw new BadRequestException('A valid Idempotency-Key header is required'); return this.tickets.create(request.user!, dto, key, request.correlationId!); }
  @Get() list(@Req() request: FastifyRequest) { return this.tickets.list(request.user!, request.correlationId!); }
  @Get('search') search(@Req() request: FastifyRequest, @Query() query: SearchTicketsQuery) { return this.tickets.search(request.user!, query, request.correlationId!); }
  @Get(':ticketId') get(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string) { return this.tickets.get(request.user!, ticketId, request.correlationId!); }
  @Put(':ticketId/retention') updateRetention(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: UpdateRetentionControlDto) { return this.tickets.updateRetentionControl(request.user!, ticketId, dto, request.correlationId!); }
  @Patch(':ticketId') update(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: UpdateTicketDto) { return this.tickets.update(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/assignments') assign(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: AssignTicketDto) { return this.tickets.assign(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/sensitive-reveals') @HttpCode(200) reveal(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string) { return this.tickets.revealReferences(request.user!, ticketId, request.correlationId!); }
  @Post(':ticketId/notes') addNote(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: AddNoteDto) { return this.tickets.addNote(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/status') transition(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: TransitionTicketDto) { return this.tickets.transition(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/attachments') createAttachment(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: CreateAttachmentDto) { return this.tickets.createAttachment(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/attachments/:attachmentId/complete') completeAttachment(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Param('attachmentId') attachmentId: string, @Body() dto: CompleteAttachmentDto) { return this.tickets.completeAttachment(request.user!, ticketId, attachmentId, dto, request.correlationId!); }
  @Post(':ticketId/attachments/:attachmentId/scan') scanAttachment(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Param('attachmentId') attachmentId: string, @Body() dto: AttachmentScanResultDto) { return this.tickets.recordAttachmentScan(request.user!, ticketId, attachmentId, dto, request.correlationId!); }
  @Get(':ticketId/attachments/:attachmentId/download') downloadAttachment(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Param('attachmentId') attachmentId: string) { return this.tickets.downloadAttachment(request.user!, ticketId, attachmentId, request.correlationId!); }
  @Post(':ticketId/relationships') linkTicket(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: LinkTicketDto) { return this.tickets.linkTicket(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/communications') createCommunication(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: CreateCommunicationDto) { return this.tickets.createCommunication(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/approvals') requestApproval(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Body() dto: ApprovalRequestDto) { return this.tickets.requestApproval(request.user!, ticketId, dto, request.correlationId!); }
  @Post(':ticketId/approvals/:approvalId/decision') decide(@Req() request: FastifyRequest, @Param('ticketId') ticketId: string, @Param('approvalId') approvalId: string, @Body() dto: ApprovalDecisionDto) { return this.tickets.decideApproval(request.user!, ticketId, approvalId, dto, request.correlationId!); }
}
