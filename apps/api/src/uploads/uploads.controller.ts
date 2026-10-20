import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PortalAttachmentDto } from '../portal/portal.dto.js';
import { CompleteAttachmentDto } from '../tickets/ticket.dto.js';
import { UploadsService } from './uploads.service.js';

const correlation = (r: FastifyRequest): string => r.correlationId ?? `upload-${randomUUID()}`; // no guard runs on these routes, so there is no request id yet

/** No sign-in: the secure link (sent in the `X-Upload-Token` header, never in the URL) is the credential. */
@Controller('upload')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}
  @Header('Cache-Control', 'no-store') @Get('status') status(@Headers('x-upload-token') token?: string) { return this.uploads.status(token); }
  @Header('Cache-Control', 'no-store') @Post('attachments') add(@Req() r: FastifyRequest, @Headers('x-upload-token') token: string | undefined, @Body() dto: PortalAttachmentDto) { return this.uploads.createIntent(token, dto, correlation(r)); }
  @Header('Cache-Control', 'no-store') @Post('attachments/:attachmentId/complete') complete(@Req() r: FastifyRequest, @Headers('x-upload-token') token: string | undefined, @Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Body() dto: CompleteAttachmentDto) { return this.uploads.complete(token, attachmentId, dto, correlation(r)); }
}
