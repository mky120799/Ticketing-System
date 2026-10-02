import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from './auth.guard.js';

@Controller('me')
@UseGuards(AuthGuard)
export class ProfileController {
  @Get()
  current(@Req() request: FastifyRequest) { return request.user; }
}
