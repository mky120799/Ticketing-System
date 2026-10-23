import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { DirectoryService } from './directory.service.js';

class LookupDto { @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Length(1, 160, { each: true }) subjects!: string[]; }
class PeopleQuery { @IsOptional() @IsString() @Length(2, 80) queue?: string; }

/** Staff names for display: `POST /directory/lookup` (IDs → names) and `GET /directory/people` (assignee pickers). */
@Controller('directory')
@UseGuards(AuthGuard)
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}
  // POST rather than GET so a long list of IDs never ends up in a URL (and in access logs).
  @Post('lookup') @HttpCode(200) lookup(@Req() r: FastifyRequest, @Body() dto: LookupDto) { return this.directory.lookup(r.user!, dto.subjects); }
  @Get('people') people(@Req() r: FastifyRequest, @Query() query: PeopleQuery) { return this.directory.people(r.user!, query.queue); }
}
