import { BadRequestException, Body, Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { INTAKE_CHANNELS, IntakeMessageDto, type IntakeChannel } from './intake.dto.js';
import { IntakeService } from './intake.service.js';

@Controller('intake')
@UseGuards(AuthGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /** Channel adapters post one normalized message here. Redelivery of the same messageId returns the original ticket. */
  @Post(':channel') @HttpCode(200)
  create(@Req() request: FastifyRequest, @Param('channel') channel: string, @Body() dto: IntakeMessageDto) {
    if (!(INTAKE_CHANNELS as readonly string[]).includes(channel)) throw new BadRequestException('Unknown intake channel');
    return this.intake.create(request.user!, channel as IntakeChannel, dto, request.correlationId!);
  }
}
