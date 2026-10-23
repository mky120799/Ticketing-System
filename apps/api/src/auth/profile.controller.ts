import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DirectoryService } from '../directory/directory.service.js';
import { AuthGuard } from './auth.guard.js';

/**
 * `GET /me`: who the caller is (roles and scope from their token). The console calls it once when it opens, which is
 * also when the person's name is recorded in the staff directory, so colleagues see them by name.
 * Registered in DirectoryModule (not AuthModule) because it needs the directory, which itself depends on AuthModule.
 */
@Controller('me')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  async current(@Req() request: FastifyRequest) {
    await this.directory.record(request.user!);
    return request.user;
  }
}
