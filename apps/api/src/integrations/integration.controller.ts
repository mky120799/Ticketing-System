import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { IntegrationReceiptDto } from './integration-receipt.dto.js';
import { IntegrationService } from './integration.service.js';
import { CommunicationDeliveryReceiptDto } from './communication-receipt.dto.js';

@Controller('integrations')
@UseGuards(AuthGuard)
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}
  @Post('outbox/:eventId/receipts') receipt(@Req() request: FastifyRequest, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: IntegrationReceiptDto) { return this.integrations.recordReceipt(request.user!, eventId, dto, request.correlationId!); }
  @Post('communications/:communicationId/receipts') communicationReceipt(@Req() request: FastifyRequest, @Param('communicationId', ParseUUIDPipe) communicationId: string, @Body() dto: CommunicationDeliveryReceiptDto) { return this.integrations.recordCommunicationReceipt(request.user!, communicationId, dto, request.correlationId!); }
}
